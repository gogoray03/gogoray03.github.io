"""Offline orchestration tests only; these do not run or measure a real model."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile
from build_notebooks import BENCHMARK
from pipeline import Pipeline
from test_pipeline import NOTE, QUESTION


class FakeRuntime:
    fail = False
    unloaded = False
    model_id = 'mock-only'
    metrics = {'model':model_id}

    def load(self, name):
        if self.fail: raise RuntimeError('mock missing GPU')

    def unload(self):
        type(self).unloaded = True

    def memory_metrics(self):
        return {'peak_allocated_gib':0}

    def generate(self, prompt):
        if '分析一個核心概念' in prompt:
            return json.dumps(dict(concept='電位', learningGoal='理解', sourceIds=['S0001']))
        if '深入教學：' in prompt: return json.dumps(NOTE)
        if '生成一題理解' in prompt: return json.dumps(QUESTION)
        if '獨立解題' in prompt: return json.dumps(dict(answer=0, unique=True, reason='mock'))
        if '評估草稿' in prompt: return json.dumps(dict(academic=2, citationSupport=2, teaching=2, reason='mock'))
        return '{"answer":0}'


class BenchmarkTests(unittest.TestCase):
    def execute(self, fail):
        FakeRuntime.fail, FakeRuntime.unloaded = fail, False
        downloads = []
        files = SimpleNamespace(download=downloads.append)
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: not fail, synchronize=lambda:None))
        modules = {'google':SimpleNamespace(), 'google.colab':SimpleNamespace(files=files),
                   'torch':torch, 'transformers':SimpleNamespace(set_seed=lambda _:None)}
        with tempfile.TemporaryDirectory() as directory:
            previous = os.getcwd()
            try:
                os.chdir(directory)
                with patch.dict(sys.modules, modules), contextlib.redirect_stdout(io.StringIO()):
                    exec(compile(BENCHMARK, 'benchmark', 'exec'), dict(ModelRuntime=FakeRuntime, Pipeline=Pipeline, MODEL='Qwen 7B', environment={'mock':True}))
                report = json.loads(Path('scholarflow-benchmark-v1.1.json').read_text(encoding='utf-8'))
                with zipfile.ZipFile(downloads[0]) as archive:
                    self.assertIn('scholarflow-benchmark-v1.1.json', archive.namelist())
                self.assertTrue(FakeRuntime.unloaded)
                return report
            finally:
                os.chdir(previous)

    def test_success_exports_audit_without_academic_claim(self):
        data = self.execute(False)
        self.assertEqual(data['report']['status'], 'completed')
        self.assertTrue(data['report']['structural_smoke_pass'])
        self.assertFalse(data['report']['academic_quality_verified'])
        self.assertTrue(data['audit'][0]['raw'])

    def test_failure_still_exports_report(self):
        data = self.execute(True)
        self.assertEqual(data['report']['status'], 'failed')
        self.assertIn('mock missing GPU', data['report']['error'])
        self.assertFalse(data['report']['structural_smoke_pass'])


if __name__ == '__main__':
    unittest.main()
