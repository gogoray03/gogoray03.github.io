import json
import tempfile
import unittest
from pathlib import Path
from pipeline import Pipeline, build_sources, map_citations, parse_json, validate_item
from model_runtime import MODELS, check_memory

PAGES = [('synthetic', '鈉通道活化造成去極化。鉀離子外流造成再極化。')]
NOTE = dict(topic='動作電位', summary='鈉通道活化造成去極化', explanation='鈉通道活化使鈉內流，造成去極化。', extension='待核實：無補充', sourceIds=['S0001'])
QUESTION = dict(topic='動作電位', question='哪種離子外流造成再極化？', options=['鉀', '鈉', '鈣', '氯'], answer=0, answerLabel='A', answerText='鉀', explanation='教材指出鉀離子外流。', sourceIds=['S0001'])


class PipelineTests(unittest.TestCase):
    def test_exact_offsets(self):
        text = ' a\n中 文。' * 100
        for s in build_sources([('page', text)]).values():
            self.assertEqual(s['text'], text[s['start']:s['end']])

    def test_unknown_source(self):
        with self.assertRaisesRegex(ValueError, 'known IDs'):
            map_citations({'sourceIds': ['S9999']}, build_sources(PAGES))

    def test_duplicate_source(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            map_citations({'sourceIds': ['S0001', 'S0001']}, build_sources(PAGES))

    def test_mapping_overrides_model_quote(self):
        note = validate_item(dict(NOTE, evidence='invented quote'), 'notes', build_sources(PAGES))
        self.assertEqual(note['evidence'], PAGES[0][1])

    def test_fenced_json(self):
        self.assertEqual(parse_json('```json\n{"a":1}\n```')[0], {'a': 1})

    def test_literal_repair(self):
        self.assertEqual(parse_json("{'a': 'b',}")[0], {'a': 'b'})

    def test_trailing_comma_preserves_strings(self):
        self.assertEqual(parse_json('{"a":true,"b":",}",}')[0], {'a': True, 'b': ',}'})

    def test_reasoning_separation(self):
        self.assertEqual(parse_json('<think>{bad}</think>{"a":1}')[0], {'a': 1})

    def test_truncation(self):
        for s in ['{"a":', '<think>{"a":1}', '[]']:
            with self.assertRaises(ValueError):
                parse_json(s)

    def test_no_code_execution(self):
        with self.assertRaises(ValueError):
            parse_json("{'a': __import__('os').getcwd()}")

    def test_retry_and_audit(self):
        replies = iter(['oops', json.dumps(NOTE)])
        with tempfile.TemporaryDirectory() as d:
            p = Pipeline(lambda prompt: next(replies), audit_path=str(Path(d)/'audit.json'))
            n = p.request('test', '', lambda o: validate_item(o, 'notes', build_sources(PAGES)))
            self.assertIsNotNone(n)
            saved = json.loads((Path(d)/'audit.json').read_text(encoding='utf-8'))
            self.assertEqual(saved[0]['raw'], 'oops')
            self.assertIn('invalid', saved[0]['error'])
            self.assertEqual(len(saved), 2)

    def test_bounded_retry(self):
        p = Pipeline(lambda prompt: '{}')
        self.assertIsNone(p.request('test', '', lambda o: validate_item(o, 'notes', {})))
        self.assertEqual(len(p.audit), 3)

    def test_options_and_answer_types(self):
        for change in [dict(answer=True), dict(answer=4), dict(options=['a', ' a ', 'b', 'c'])]:
            with self.assertRaises(ValueError):
                validate_item(dict(QUESTION, **change), 'questions', build_sources(PAGES))

    def run_flow(self, answer=0):
        attempts = 1 if answer == 0 else 3
        replies = iter([dict(concept='電位', learningGoal='理解電位', sourceIds=['S0001']), NOTE,
                        *[x for _ in range(attempts) for x in [QUESTION, dict(answer=answer, unique=True, reason='教材支持')]],
                        dict(academic=2, citationSupport=2, teaching=2, reason='模型評估')])
        return Pipeline(lambda prompt: json.dumps(next(replies))).run(PAGES, 'test', 'mock')

    def test_end_to_end_mock(self):
        r = self.run_flow()
        self.assertEqual((len(r['notes']), len(r['questions'])), (1, 1))
        self.assertFalse(r['evaluation']['academic_quality_verified'])
        self.assertFalse(r['evaluation']['semantic_support_verified'])

    def test_disagreement_rejected(self):
        r = self.run_flow(1)
        self.assertEqual(r['questions'], [])
        self.assertTrue(any('答案驗證' in w for w in r['warnings']))

    def test_resource_failure_not_retried(self):
        def fail(prompt):
            raise RuntimeError('GPU OOM')
        p = Pipeline(fail)
        with self.assertRaises(RuntimeError):
            p.request('x', '', lambda x: x)
        self.assertEqual(len(p.audit), 1)
        self.assertIn('GPU OOM', p.audit[0]['error'])

    def test_memory_guard(self):
        with self.assertRaises(RuntimeError):
            check_memory(5, 7)
        check_memory(14.56, 7)
        self.assertEqual(len(MODELS), 4)

    def test_empty_corpus_not_success(self):
        r = Pipeline(lambda _: '{}').run([], 'test', 'mock')
        self.assertFalse(r['notes'] or r['questions'])


if __name__ == '__main__':
    unittest.main()
