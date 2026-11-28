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


def protected_stack():
    """Resolve one constraint per normalized name using worker metadata precedence."""
    from packaging.utils import canonicalize_name
    discovered = {}
    for dist in metadata.distributions():
        name = canonicalize_name(dist.metadata.get('Name') or '')
        if name in ('torch', 'numpy', 'triton') or name.startswith('nvidia-'):
            discovered.setdefault(name, set()).add(dist.version)
    selected = {name: metadata.version(name) for name in sorted(discovered)}
    duplicates = {name: sorted(versions) for name, versions in discovered.items() if len(versions) > 1}
    return dict(selected=selected, duplicates=duplicates)


def pip_check(python):
    command = [sys.executable, '-m', 'pip']
    if Path(python).resolve() != Path(sys.executable).resolve() or str(python) != sys.executable:
        command.extend(['--python', str(python)])
    run = subprocess.run([*command, 'check'], capture_output=True, text=True)
    return dict(returncode=run.returncode, output=run.stdout + run.stderr)


def setup_worker(packages, root='scholarflow-worker-env'):
    root = Path(root).resolve()
    before = pip_check(sys.executable)
    environment = dict(version='1.1.3', python=sys.version, isolation='worker_venv_with_system_packages',
                       host_pip_check_before=before, dependency_check_pass=False)
    destination = Path('scholarflow-environment.json')
    try:
        environment['setup_stage'] = 'create_venv_without_ensurepip'
        # Colab Python 3.13 can fail during ensurepip; use the host pip CLI targeting the worker.
        venv.EnvBuilder(with_pip=False, system_site_packages=True).create(root)
        python = root / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
        # Freeze the existing heavyweight stack: incompatible upgrades must fail resolution.
        environment['setup_stage'] = 'resolve_worker_stack'
        stack_probe = 'import json; from colab_environment import protected_stack; print(json.dumps(protected_stack()))'
        stack_run = subprocess.run([str(python), '-c', stack_probe], capture_output=True, text=True, check=True)
        stack = json.loads(stack_run.stdout)
        environment['protected_stack'] = stack
        protected = [f'{name}=={version}' for name, version in sorted(stack['selected'].items())]
        constraint = root / 'host-stack-constraints.txt'
        constraint.write_text('\n'.join(protected) + '\n', encoding='utf-8')
        environment['setup_stage'] = 'install_worker_packages'
        install = subprocess.run([sys.executable, '-m', 'pip', '--python', str(python), 'install', '--disable-pip-version-check',
                    '-c', str(constraint), *packages], capture_output=True, text=True)
        Path('scholarflow-install.log').write_text(install.stdout + install.stderr, encoding='utf-8')
        environment['install_returncode'] = install.returncode
        if install.returncode:
            raise RuntimeError('Worker installation failed; inspect scholarflow-install.log')
        probe = 'import json; from colab_environment import dependency_closure; print(json.dumps(dependency_closure(' + repr(packages) + ')))'
        environment['setup_stage'] = 'verify_worker_dependencies'
        closure = subprocess.run([str(python), '-c', probe], capture_output=True, text=True, check=True)
        environment['inference_dependencies'] = json.loads(closure.stdout)
        environment['worker_pip_check'] = pip_check(python)
        after = pip_check(sys.executable)
        environment['host_pip_check_after'] = after
        environment['host_environment_unchanged'] = before == after
        environment['dependency_check_pass'] = environment['inference_dependencies']['pass_check'] and before == after
        if not environment['dependency_check_pass']:
            raise RuntimeError('Inference dependencies incompatible or host check changed; see scholarflow-environment.json')
        environment['setup_stage'] = 'complete'
        return str(python), environment
    except Exception as exc:
        environment['setup_error'] = f'{type(exc).__name__}: {exc}'
        if isinstance(exc, subprocess.CalledProcessError):
            environment['subprocess_stdout'] = str(exc.stdout or '')
            environment['subprocess_stderr'] = str(exc.stderr or '')
        environment['host_pip_check_after'] = pip_check(sys.executable)
        raise
    finally:
        destination.write_text(json.dumps(environment, ensure_ascii=False, indent=2), encoding='utf-8')


def launch_worker(python, script, arguments=()):
    """Separate process avoids cached notebook imports; stream its progress live."""
    return subprocess.run([str(python), '-u', str(script), *arguments]).returncode
