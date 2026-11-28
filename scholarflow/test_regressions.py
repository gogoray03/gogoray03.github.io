"""Regression cases from the user's synthetic T4 run; no paid model calls."""
import json
from pathlib import Path
import unittest
from pipeline import Pipeline, answer_fields, clean_options, normalize_answer, build_sources, validate_item
from test_pipeline import PAGES, QUESTION
import test_pipeline


class AnswerRegressionTests(unittest.TestCase):
    def test_letter_is_normalized_without_regeneration(self):
        replies = iter([QUESTION, dict(answer='A', unique=True, reason='source')])
        p = Pipeline(lambda _: json.dumps(next(replies)))
        q, failures = p.make_question(build_sources(PAGES), '', '')
        self.assertEqual(q['answer'], 0)
        self.assertEqual(failures, [])
        self.assertEqual(len([e for e in p.audit if e['stage']=='answer_verification']), 1)
        self.assertEqual(p.audit[1]['normalized_answer'], 0)

    def test_exact_option_and_singleton_array(self):
        options = QUESTION['options']
        self.assertEqual(normalize_answer(['鈉'], options), 1)
        self.assertEqual(normalize_answer('C', options), 2)
        self.assertEqual(normalize_answer('不一定', ['是','否','不一定','未知']), 2)

    def test_ambiguous_answers_rejected(self):
        for value in [True, 4, ['A','B'], 'A or B', '第二個', None]:
            with self.assertRaises(ValueError): normalize_answer(value, QUESTION['options'])

    def test_mismatched_label_and_text_rejected(self):
        with self.assertRaisesRegex(ValueError, 'disagree'):
            answer_fields({'answerLabel':'C', 'answerText':'鈉'}, QUESTION['options'])

    def test_no_one_based_guess(self):
        self.assertEqual(normalize_answer(3, QUESTION['options']), 3)

    def test_answer_text_is_literal_even_when_it_is_a_letter(self):
        self.assertEqual(answer_fields({'answerLabel':'A', 'answerText':'B'}, ['B','D','A','C']), 0)
        with self.assertRaises(ValueError):
            answer_fields({'answerText':'A'}, QUESTION['options'])

    def test_original_t4_duplicate_options_rejected(self):
        fixture = json.loads((Path(__file__).parent/'fixtures/t4-v1.1-question.json').read_text(encoding='utf-8'))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            clean_options(fixture['question']['options'])
        self.assertEqual(normalize_answer(fixture['first_verification']['answer'], fixture['question']['options']), 2)

    def test_disagreement_regenerates_entire_question(self):
        replies = iter([QUESTION, dict(answer='B', unique=True, reason='disagrees'),
                        dict(QUESTION, question='根據教材，哪種離子外流？'),
                        dict(answer='A', unique=True, reason='agrees')])
        p = Pipeline(lambda _: json.dumps(next(replies)))
        q, failures = p.make_question(build_sources(PAGES), '', '')
        self.assertEqual(q['question'], '根據教材，哪種離子外流？')
        self.assertEqual(len(failures), 1)
        self.assertEqual([e['accepted'] for e in p.audit if e['stage']=='question_gate'], [False, True])

    def test_failed_candidates_bounded(self):
        p = Pipeline(lambda _: '{}')
        q, failures = p.make_question(build_sources(PAGES), '', '')
        self.assertIsNone(q)
        self.assertEqual(len(failures), 3)
        self.assertEqual(len(p.audit), 3)

    def test_full_self_scores_do_not_hide_failed_gate(self):
        result = test_pipeline.PipelineTests().run_flow(1)
        review = result['evaluation']['reviews'][0]
        self.assertEqual(review['review']['academic'], 2)
        self.assertEqual(review['question_status'], 'rejected')
        self.assertFalse(review['completeness_pass'])
        self.assertFalse(review['academic_quality_verified'])


if __name__ == '__main__': unittest.main()
