import contextlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import colab_environment as env


class EnvironmentTests(unittest.TestCase):
    def test_closure_excludes_unrelated_packages_but_checks_transitive_versions(self):
        dists = {'app':SimpleNamespace(version='1', requires=['shared>=2']),
                 'shared':SimpleNamespace(version='1', requires=[])}
        with patch.object(env.metadata, 'distribution', side_effect=lambda n:dists[n]):
            result = env.dependency_closure(['app==1'])
        self.assertFalse(result['pass_check'])
        self.assertIn('shared>=2', result['errors'][0])
        self.assertEqual(set(result['versions']), {'app','shared'})

    def test_optional_extra_not_required_unless_selected(self):
        root = SimpleNamespace(version='1', requires=['missing; extra == "optional"'])
        def distribution(name):
            if name == 'app': return root
            raise env.metadata.PackageNotFoundError(name)
        with patch.object(env.metadata, 'distribution', side_effect=distribution):
            self.assertTrue(env.dependency_closure(['app'])['pass_check'])
            self.assertFalse(env.dependency_closure(['app[optional]'])['pass_check'])

    def setup_case(self, install_code=0):
        previous = os.getcwd()
        try:
            with tempfile.TemporaryDirectory() as directory, contextlib.chdir(directory):
                worker = (Path(directory)/'env').resolve()
                commands = []
                def run(args, **kwargs):
                    commands.append(args)
                    if 'install' in args: return SimpleNamespace(returncode=install_code, stdout='install output', stderr='')
                    return SimpleNamespace(returncode=0, stdout=json.dumps({'pass_check':True, 'errors':[], 'versions':{}}), stderr='')
                def create(path): Path(path).mkdir()
                with patch.object(env.venv, 'EnvBuilder') as builder, patch.object(env.subprocess, 'run', side_effect=run), patch.object(env, 'pip_check', return_value={'returncode':1,'output':'preexisting missing jedi'}), patch.object(env.metadata, 'distributions', return_value=[]):
                    builder.return_value.create.side_effect = create
                    if install_code:
                        with self.assertRaises(RuntimeError): env.setup_worker(['transformers==4.51.3'], worker)
                    else:
                        python, _ = env.setup_worker(['transformers==4.51.3'], worker)
                        self.assertTrue(str(python).startswith(str(worker)))
                    builder.assert_called_once_with(with_pip=False, system_site_packages=True)
                report = json.loads(Path('scholarflow-environment.json').read_text(encoding='utf-8'))
                self.assertTrue(Path('scholarflow-install.log').exists())
                self.assertEqual(commands[0][:5], [env.sys.executable, '-m', 'pip', '--python', str(worker / ('Scripts/python.exe' if env.sys.platform == 'win32' else 'bin/python'))])
                self.assertTrue(all(str(c[0]).startswith(str(worker)) for c in commands[1:]))
                return report
        finally:
            os.chdir(previous)

    def test_install_only_targets_worker(self):
        report = self.setup_case()
        self.assertTrue(report['dependency_check_pass'])
        self.assertEqual(report['host_pip_check_after']['returncode'], 1)
        self.assertEqual(report['worker_pip_check']['returncode'], 1)

    def test_install_failure_persists_diagnostics(self):
        report = self.setup_case(1)
        self.assertFalse(report['dependency_check_pass'])
        self.assertIn('setup_error', report)


if __name__ == '__main__': unittest.main()
