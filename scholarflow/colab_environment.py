"""Colab worker overlay: installs never target the notebook's base environment.

The worker inherits system packages to reuse torch/CUDA (not a hermetic venv).
Full pip-check diagnostics and the inference dependency closure are both reported.
"""
import importlib.metadata as metadata
import json
from pathlib import Path
import subprocess
import sys
import venv


def dependency_closure(roots):
    from packaging.requirements import Requirement
    from packaging.utils import canonicalize_name
    queue = list(roots)
    visited, versions, errors = set(), {}, []
    while queue:
        spec = queue.pop()
        requirement = Requirement(spec)
        name = canonicalize_name(requirement.name)
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            errors.append(f'{spec}: not installed')
            continue
        versions[name] = dist.version
        if requirement.specifier and not requirement.specifier.contains(dist.version, prereleases=True):
            errors.append(f'{spec}: installed {dist.version}')
        extras = {''} | set(requirement.extras)
        for extra in extras:
            if (name, extra) in visited:
                continue
            visited.add((name, extra))
            for child in dist.requires or []:
                req = Requirement(child)
                if req.marker is None or req.marker.evaluate({'extra': extra}):
                    queue.append(str(req))
    return dict(pass_check=not errors, errors=sorted(set(errors)), versions=versions)


def pip_check(python):
    run = subprocess.run([str(python), '-m', 'pip', 'check'], capture_output=True, text=True)
    return dict(returncode=run.returncode, output=run.stdout + run.stderr)


def setup_worker(packages, root='scholarflow-worker-env'):
    root = Path(root).resolve()
    before = pip_check(sys.executable)
    environment = dict(version='1.1.1', python=sys.version, isolation='worker_venv_with_system_packages',
                       host_pip_check_before=before, dependency_check_pass=False)
    destination = Path('scholarflow-environment.json')
    try:
        venv.EnvBuilder(with_pip=True, system_site_packages=True).create(root)
        python = root / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
        # Freeze the existing heavyweight stack: incompatible upgrades must fail resolution.
        protected = []
        for dist in metadata.distributions():
            name = dist.metadata.get('Name', '').lower().replace('_', '-')
            if name in ('torch', 'numpy', 'triton') or name.startswith('nvidia-'):
                protected.append(f'{name}=={dist.version}')
        constraint = root / 'host-stack-constraints.txt'
        constraint.write_text('\n'.join(sorted(set(protected))) + '\n', encoding='utf-8')
        install = subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                    '-c', str(constraint), *packages], capture_output=True, text=True)
        Path('scholarflow-install.log').write_text(install.stdout + install.stderr, encoding='utf-8')
        environment['install_returncode'] = install.returncode
        if install.returncode:
            raise RuntimeError('Worker installation failed; inspect scholarflow-install.log')
        probe = 'import json; from colab_environment import dependency_closure; print(json.dumps(dependency_closure(' + repr(packages) + ')))'
        closure = subprocess.run([str(python), '-c', probe], capture_output=True, text=True, check=True)
        environment['inference_dependencies'] = json.loads(closure.stdout)
        environment['worker_pip_check'] = pip_check(python)
        after = pip_check(sys.executable)
        environment['host_pip_check_after'] = after
        environment['host_environment_unchanged'] = before == after
        environment['dependency_check_pass'] = environment['inference_dependencies']['pass_check'] and before == after
        if not environment['dependency_check_pass']:
            raise RuntimeError('Inference dependencies incompatible or host check changed; see scholarflow-environment.json')
        return str(python), environment
    except Exception as exc:
        environment['setup_error'] = f'{type(exc).__name__}: {exc}'
        environment['host_pip_check_after'] = pip_check(sys.executable)
        raise
    finally:
        destination.write_text(json.dumps(environment, ensure_ascii=False, indent=2), encoding='utf-8')


def launch_worker(python, script, arguments=()):
    """Separate process avoids cached notebook imports; stream its progress live."""
    return subprocess.run([str(python), '-u', str(script), *arguments]).returncode
