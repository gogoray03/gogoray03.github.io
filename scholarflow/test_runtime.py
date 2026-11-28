import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from model_runtime import ModelRuntime


class RuntimeTests(unittest.TestCase):
    def modules(self, free=14):
        cuda = MagicMock()
        cuda.is_available.return_value = True
        cuda.mem_get_info.return_value = (free * 2**30, 15 * 2**30)
        cuda.get_device_name.return_value = 'mock GPU'
        torch = SimpleNamespace(cuda=cuda, float16='float16')
        model = MagicMock()
        model.config._commit_hash = 'mock-revision'
        transformers = SimpleNamespace(AutoTokenizer=MagicMock(), AutoModelForCausalLM=MagicMock(), BitsAndBytesConfig=MagicMock())
        transformers.AutoModelForCausalLM.from_pretrained.return_value = model
        return torch, transformers

    def test_unload_clears_owned_references(self):
        torch, tf = self.modules()
        with patch.dict(sys.modules, {'torch':torch, 'transformers':tf}):
            r = ModelRuntime()
            r.load()
            self.assertIsNotNone(r.model)
            r.unload()
            self.assertIsNone(r.model)
            self.assertIsNone(r.tokenizer)
            self.assertTrue(torch.cuda.empty_cache.called)

    def test_memory_rejection_precedes_download(self):
        torch, tf = self.modules(free=5)
        with patch.dict(sys.modules, {'torch':torch, 'transformers':tf}):
            with self.assertRaises(RuntimeError):
                ModelRuntime().load()
            tf.AutoTokenizer.from_pretrained.assert_not_called()

    def test_failed_load_unloads(self):
        torch, tf = self.modules()
        tf.AutoModelForCausalLM.from_pretrained.side_effect = RuntimeError('OOM')
        with patch.dict(sys.modules, {'torch':torch, 'transformers':tf}):
            r = ModelRuntime()
            with self.assertRaises(RuntimeError):
                r.load()
            self.assertIsNone(r.model)
            self.assertIsNone(r.tokenizer)

    def test_switch_unloads_first_model(self):
        torch, tf = self.modules()
        with patch.dict(sys.modules, {'torch':torch, 'transformers':tf}):
            r = ModelRuntime()
            r.load('Qwen 7B')
            tf.AutoTokenizer.from_pretrained.reset_mock()
            r.load('DeepSeek 14B')
            self.assertIn('DeepSeek-R1-Distill-Qwen-14B', r.model_id)
            self.assertEqual(tf.AutoTokenizer.from_pretrained.call_count, 1)
            self.assertGreaterEqual(torch.cuda.empty_cache.call_count, 2)


if __name__ == '__main__':
    unittest.main()
