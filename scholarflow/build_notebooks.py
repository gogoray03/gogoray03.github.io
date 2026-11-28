"""Build self-contained Colab notebooks from the exact tested Python sources."""
import json
from pathlib import Path

ROOT = Path(__file__).parent


def cell(kind, text):
    c = dict(cell_type=kind, metadata={}, source=text.splitlines(keepends=True))
    if kind == 'code':
        c.update(execution_count=None, outputs=[])
    return c


INSTALL = '''from colab_environment import setup_worker, launch_worker
WORKER_PYTHON, environment = setup_worker(REQUIREMENTS)
print('推理相依性檢查：', environment['dependency_check_pass'])
print('主環境檢查未改變：', environment['host_environment_unchanged'])
print('Worker 全環境 pip check（含未使用的繼承套件）：', environment['worker_pip_check'])
'''

BENCHMARK = '''import json, time, traceback, zipfile
from pathlib import Path
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
Path('scholarflow-audit.json').write_text('[]', encoding='utf-8')
report = {'version':'1.1.1', 'requested_model':MODEL, 'status':'started',
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
            return {'answer':answer_fields(o, item['options'])}
        prompt = '根據教材解題，只輸出 {"answerLabel":"A"}。教材：' + json.dumps(pages, ensure_ascii=False)
        prompt += '\\n題目：' + json.dumps({'question':item['question'],'options':dict(zip('ABCD',item['options']))}, ensure_ascii=False)
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
            for name in ['scholarflow-benchmark-v1.1.json','scholarflow-environment.json','scholarflow-review-template.json','scholarflow-audit.json','scholarflow-install.log']:
                if Path(name).exists(): z.write(name)
        print(json.dumps(report, ensure_ascii=False, indent=2))
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
finally:
    runtime.unload()
    print('模型已卸載。私人教材診斷保留在 Colab 的 scholarflow-private-audit.json；不會上傳 GitHub。')
'''


def build():
    packages = [s for s in (ROOT/'requirements-colab.txt').read_text().splitlines() if s and not s.startswith('#')]
    setup = INSTALL.replace('REQUIREMENTS', repr(packages))
    modules = ['pipeline.py', 'model_runtime.py', 'colab_environment.py', 'extract_uploads.py']
    write_modules = 'from pathlib import Path\n' + '\n'.join(
        f'Path({name!r}).write_text({(ROOT/name).read_text(encoding="utf-8")!r}, encoding="utf-8")'
        for name in modules)
    common = [cell('code', write_modules), cell('code', setup),
              cell('code', '# @title 模型選擇（先驗證 Qwen 7B，再手動切換）\nMODEL = "Qwen 7B" # @param ["Qwen 7B", "Qwen 14B", "DeepSeek 7B", "DeepSeek 14B"]\n')]
    header = 'import sys, json\nfrom pipeline import Pipeline, answer_fields\nfrom model_runtime import ModelRuntime\nfrom pathlib import Path\nMODEL = sys.argv[1]\nenvironment = json.loads(Path("scholarflow-environment.json").read_text(encoding="utf-8"))\n'
    benchmark_worker = header + BENCHMARK
    benchmark_launch = (f'Path("benchmark_worker.py").write_text({benchmark_worker!r}, encoding="utf-8")\n'
        'returncode = launch_worker(WORKER_PYTHON, "benchmark_worker.py", [MODEL])\n'
        'from google.colab import files\n'
        'if returncode == 0 and Path("scholarflow-benchmark-v1.1.zip").exists():\n'
        '    files.download("scholarflow-benchmark-v1.1.zip")\n'
        'else:\n'
        '    raise RuntimeError(f"Worker exited {returncode} before exporting a report; inspect output above")\n')
    upload_worker = (header + 'import base64\nfrom extract_uploads import extract\n'
        'uploads = {k:base64.b64decode(v) for k,v in json.loads(Path("scholarflow-uploads.json").read_text(encoding="utf-8")).items()}\n'
        'task, sources, warnings = extract(uploads)\n' + UPLOAD_RUN)
    upload_launch = ('from google.colab import files\nimport base64, json\n'
        'uploads = files.upload()\n'
        'Path("scholarflow-uploads.json").write_text(json.dumps({k:base64.b64encode(v).decode("ascii") for k,v in uploads.items()}), encoding="utf-8")\n'
        f'Path("upload_worker.py").write_text({upload_worker!r}, encoding="utf-8")\n'
        'returncode = launch_worker(WORKER_PYTHON, "upload_worker.py", [MODEL])\n'
        'if returncode == 0 and Path("scholarflow-result.json").exists():\n'
        '    files.download("scholarflow-result.json")\n'
        'else:\n'
        '    raise RuntimeError("教材處理失敗，請檢查上方錯誤及私人 audit")\n')
    for name, cells in [
        ('benchmark-v1.1.ipynb', [cell('markdown', '# ScholarFlow AI V1.1.1 Benchmark\n選全新 GPU 執行階段後「全部執行」。預設 Qwen 7B，不需上傳或金鑰。套件安裝在 worker venv，繼承現有 PyTorch/CUDA，不修改主環境套件。這是程序隔離而非完全封閉環境；報告分開記錄推理相依性與完整 pip check。\n答案表示法會明確正規化，重複或覆核不一致的題目最多重生三次。模型自評與格式通過皆不代表學術正確。ZIP 保存每次輸出、錯誤及人工評估表。14B 仍可能 OOM。'), *common, cell('code', benchmark_launch)]),
        ('scholarflow.ipynb', [cell('markdown', '# ScholarFlow AI V1.1.1\n選全新 Colab GPU 執行階段並全部執行，上傳任務 JSON 與獲授權教材。模型於 worker 程序執行。原文和診斷僅留在你的 Colab。無 OCR；內容需人工查核。'), *common, cell('code', upload_launch)])]:
        for i, c in enumerate(cells): c['id'] = f'sf11-{i}'
        nb = dict(nbformat=4, nbformat_minor=5, metadata=dict(colab={'name':name,'provenance':[]}, accelerator='GPU', kernelspec={'display_name':'Python 3','language':'python','name':'python3'}, language_info={'name':'python'}), cells=cells)
        (ROOT/name).write_text(json.dumps(nb, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    build()
