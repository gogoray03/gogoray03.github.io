"""Lazy GPU runtime; imports no torch until used. One model resident at a time."""
import gc
import time

MODELS = {
    'Qwen 7B': ('Qwen/Qwen2.5-7B-Instruct', 7.0),
    'Qwen 14B': ('Qwen/Qwen2.5-14B-Instruct', 12.0),
    'DeepSeek 7B': ('deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', 7.5),
    'DeepSeek 14B': ('deepseek-ai/DeepSeek-R1-Distill-Qwen-14B', 12.5),
}


def check_memory(free_gib, required_gib):
    if free_gib < required_gib:
        raise RuntimeError(f'Free GPU memory {free_gib:.2f} GiB < estimated minimum {required_gib:.2f} GiB. Select 7B or a larger GPU.')


class ModelRuntime:
    def __init__(self):
        self.model = self.tokenizer = None
        self.model_id = None
        self.metrics = {}

    def unload(self):
        self.model = self.tokenizer = None
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def load(self, name='Qwen 7B'):
        if name not in MODELS:
            raise ValueError('Unknown model: ' + name)
        self.unload()
        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
        if not torch.cuda.is_available():
            raise RuntimeError('GPU required. Select a Colab GPU runtime; CPU is not benchmarked.')
        self.model_id, minimum = MODELS[name]
        free, total = torch.cuda.mem_get_info()
        check_memory(free / 2**30, minimum)
        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        try:
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_id, trust_remote_code=False)
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_id, trust_remote_code=False, device_map={'': 0},
                torch_dtype=torch.float16,
                quantization_config=BitsAndBytesConfig(load_in_4bit=True,
                    bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True,
                    bnb_4bit_compute_dtype=torch.float16))
            self.model.eval()
            torch.cuda.synchronize()
            self.metrics = dict(model=self.model_id, gpu=torch.cuda.get_device_name(0),
                vram_gib=total / 2**30, free_before_load_gib=free / 2**30,
                model_load_seconds=time.perf_counter() - started,
                model_revision=getattr(self.model.config, '_commit_hash', None))
        except Exception:
            self.unload()
            raise

    def generate(self, prompt):
        import torch
        if self.model is None:
            raise RuntimeError('Model is not loaded')
        deepseek = 'DeepSeek' in self.model_id
        budget = 3072 if deepseek else 1200
        # All instructions in user role: also compatible with R1 distill templates.
        text = self.tokenizer.apply_chat_template([dict(role='user', content=prompt)],
                    tokenize=False, add_generation_prompt=True)
        inputs = self.tokenizer(text, return_tensors='pt')
        if inputs['input_ids'].shape[1] + budget > 8192:
            raise ValueError('context exceeds 8192-token safety budget; reduce source group size')
        inputs = inputs.to('cuda:0')
        try:
            kwargs = dict(max_new_tokens=budget, do_sample=deepseek,
                          pad_token_id=self.tokenizer.eos_token_id)
            if deepseek:
                kwargs.update(temperature=0.6, top_p=0.95)
            with torch.inference_mode():
                output = self.model.generate(**inputs, **kwargs)
            return self.tokenizer.decode(output[0, inputs['input_ids'].shape[1]:], skip_special_tokens=True)
        except torch.cuda.OutOfMemoryError:
            self.unload()
            raise
        finally:
            del inputs

    def memory_metrics(self):
        import torch
        return dict(peak_allocated_gib=torch.cuda.max_memory_allocated() / 2**30,
                    peak_reserved_gib=torch.cuda.max_memory_reserved() / 2**30)
