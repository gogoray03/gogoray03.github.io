"""Build self-contained Colab notebooks from the exact tested Python sources."""
import json
from pathlib import Path

ROOT = Path(__file__).parent


def cell(kind, text):
    c = dict(cell_type=kind, metadata={}, source=text.splitlines(keepends=True))
    if kind == 'code':
        c.update(execution_count=None, outputs=[])
    return c


INSTALL = '''import sys, subprocess, importlib.metadata as md, json
from pathlib import Path
# Install before importing transformers; keep Colab's torch/CUDA/numpy stack.
packages = REQUIREMENTS
before = subprocess.run([sys.executable, '-m', 'pip', 'check'], capture_output=True, text=True)
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', *packages], check=True)
after = subprocess.run([sys.executable, '-m', 'pip', 'check'], capture_output=True, text=True)
environment = {'python': sys.version, 'dependency_check_pass': after.returncode == 0, 'pip_check_before': before.stdout + before.stderr,
               'pip_check_after': after.stdout + after.stderr,
               'versions': {p.split('==')[0]: md.version(p.split('==')[0]) for p in packages}}
Path('scholarflow-environment.json').write_text(json.dumps(environment, indent=2), encoding='utf-8')
print(environment)
if after.returncode:
    print('套件環境仍有衝突，已保存 pip check 詳情；不要將本次視為相依性驗證通過。')
'''

BENCHMARK = '''import json, time, traceback, zipfile
from pathlib import Path
from google.colab import files
import torch
from transformers import set_seed
set_seed(42)
pages = [
 ('合成教材 1', '動作電位通常由電壓閘控鈉離子通道的活化引起快速去極化。鈉通道隨後失活，電壓閘控鉀離子通道開啟增加鉀離子外流，使膜電位再極化。動作電位的峰值不必等於鈉離子的平衡電位，因為膜電位受到多種離子電流共同影響。絕對不反應期與鈉通道失活有關。'),
 ('合成教材 2', '靜止膜電位主要受到鉀離子濃度梯度及細胞膜對各離子的相對通透性影響。Nernst equation 描述單一離子達到電化學平衡時的膜電位，Goldman equation 則能考慮多種離子的相對通透性。課程學習目標：區分平衡電位與實際膜電位，並能解釋動作電位各階段的因果關係。')]
# Fixed questions and manually authored keys are separate from generated questions.
gold = [
 {'question':'哪個通道的活化通常造成快速去極化？', 'options':['鈉通道','鉀通道','所有通道關閉','無法判定'], 'answer':0},
 {'question':'Nernst equation 描述什麼？', 'options':['多種離子的通透性','單一離子的電化學平衡','突觸數量','軸突長度'], 'answer':1},
 {'question':'動作電位峰值必定等於鈉平衡電位嗎？', 'options':['必定相等','只有零度相等','不一定','教材未提及'], 'answer':2}]
runtime = ModelRuntime()
pipeline = Pipeline(runtime.generate, audit_path='scholarflow-audit.json')
report = {'version':'1.1', 'requested_model':MODEL, 'status':'started',
          'academic_quality_verified':False, 'environment':environment,
          'prior_user_run':{'model':'Qwen2.5-7B-Instruct','gpu':'Tesla T4','vram_gib':14.56,
              'peak_allocated_gib':5.66,'model_load_seconds':498.06,'analysis_seconds':67.26,'accepted':0,'rejected':8}}
result = None
try:
    runtime.load(MODEL)
    report.update(runtime.metrics)
    started = time.perf_counter()
    result = pipeline.run(pages, 'benchmark-sample', runtime.model_id)
    torch.cuda.synchronize()
    report['analysis_seconds'] = time.perf_counter() - started
    outcomes = []
    for item in gold:
        def check(o):
            if type(o.get('answer')) is not int or not 0 <= o['answer'] < 4:
                raise ValueError('answer must be integer 0..3')
            return o
        prompt = '根據教材解題，只輸出 {"answer":0}。教材：' + json.dumps(pages, ensure_ascii=False)
        prompt += '\\n題目：' + json.dumps({k:v for k,v in item.items() if k != 'answer'}, ensure_ascii=False)
        prediction = pipeline.request('fixed_gold_qa', prompt, check)
        outcomes.append({'question':item, 'prediction':prediction, 'correct':bool(prediction and prediction['answer']==item['answer'])})
    report.update(runtime.memory_metrics())
    report.update(status='completed', notes=len(result['notes']), questions=len(result['questions']),
        structural_smoke_pass=bool(result['notes'] and result['questions']),
        fixed_gold_correct=sum(o['correct'] for o in outcomes), fixed_gold_total=len(gold), fixed_gold_details=outcomes,
        academic_evaluation=result['evaluation'])
except Exception as exc:
    report.update(status='failed', error=f'{type(exc).__name__}: {exc}', traceback=traceback.format_exc(), structural_smoke_pass=False)
finally:
    try:
        if torch.cuda.is_available():
            report.update(runtime.memory_metrics())
        runtime.unload()
    finally:
        Path('scholarflow-benchmark-v1.1.json').write_text(json.dumps({'report':report,'result':result,'audit':pipeline.audit,'sources':pages}, ensure_ascii=False, indent=2), encoding='utf-8')
        Path('scholarflow-review-template.json').write_text(json.dumps({'status':'pending','reviewer':None,'academic_score_0_2':None,'citation_support_score_0_2':None,'teaching_score_0_2':None,'corrections':[]}, indent=2), encoding='utf-8')
        with zipfile.ZipFile('scholarflow-benchmark-v1.1.zip','w',zipfile.ZIP_DEFLATED) as z:
            for name in ['scholarflow-benchmark-v1.1.json','scholarflow-environment.json','scholarflow-review-template.json','scholarflow-audit.json']:
                if Path(name).exists(): z.write(name)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        files.download('scholarflow-benchmark-v1.1.zip')
'''

UPLOAD_RUN = '''import json
from pathlib import Path
runtime = ModelRuntime()
pipeline = Pipeline(runtime.generate, audit_path='scholarflow-private-audit.json')
try:
    runtime.load(MODEL)
    result = pipeline.run(sources, task['courseId'], runtime.model_id)
    result['warnings'].extend(warnings)
    Path('scholarflow-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    files.download('scholarflow-result.json')
finally:
    runtime.unload()
    print('模型已卸載。私人教材診斷保留在 Colab 的 scholarflow-private-audit.json；不會上傳 GitHub。')
'''


def build():
    old = json.loads((ROOT / 'scholarflow.ipynb').read_text(encoding='utf-8'))
    # Keep original, proven PDF/PPTX/DOCX extraction, independent of inference changes.
    upload = next(''.join(c['source']) for c in old['cells'] if 'uploads = files.upload()' in ''.join(c['source']))
    packages = [s for s in (ROOT/'requirements-colab.txt').read_text().splitlines() if s and not s.startswith('#')]
    setup = INSTALL.replace('REQUIREMENTS', repr(packages))
    common = [cell('code', setup), cell('code', (ROOT/'pipeline.py').read_text(encoding='utf-8')),
              cell('code', (ROOT/'model_runtime.py').read_text(encoding='utf-8')),
              cell('code', '# @title 模型選擇（先驗證 Qwen 7B，再手動切換）\nMODEL = "Qwen 7B" # @param ["Qwen 7B", "Qwen 14B", "DeepSeek 7B", "DeepSeek 14B"]\n')]
    for name, cells in [
        ('benchmark-v1.1.ipynb', [cell('markdown', '# ScholarFlow AI V1.1 Benchmark\n選 GPU 後按「全部執行」，不需上傳資料或金鑰。預設 Qwen 7B。請使用全新 Colab 執行階段；勿在已匯入舊套件的執行階段安裝。GPU 不保證可用。\n自編教材、原始輸出、重試錯誤、環境、來源及人工評估表會下載為 ZIP。JSON 通過、來源映射、同模型覆核與三題固定答案測試都不能證明學術正確。14B 記憶體門檻為估計，仍可能 OOM。DeepSeek 使用 R1-Distill-Qwen，推理輸出可能因長度限制截斷。'), *common, cell('code', BENCHMARK)]),
        ('scholarflow.ipynb', [cell('markdown', '# ScholarFlow AI V1.1\n選擇全新 Colab GPU 執行階段並全部執行，上傳任務 JSON 與獲授權的教材。原文和診斷僅留在你的 Colab。無 OCR；生成內容仍需人工查核。'), *common, cell('code', upload), cell('code', UPLOAD_RUN)])]:
        for i, c in enumerate(cells): c['id'] = f'sf11-{i}'
        nb = dict(nbformat=4, nbformat_minor=5, metadata=dict(colab={'name':name,'provenance':[]}, accelerator='GPU', kernelspec={'display_name':'Python 3','language':'python','name':'python3'}, language_info={'name':'python'}), cells=cells)
        (ROOT/name).write_text(json.dumps(nb, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    build()
