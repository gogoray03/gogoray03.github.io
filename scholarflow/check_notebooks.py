"""Run with nbformat installed. Validates format, Python syntax and embedded source parity."""
import ast
from pathlib import Path
import nbformat

root = Path(__file__).parent
for name in ['scholarflow.ipynb', 'benchmark-v1.1.ipynb']:
    nb = nbformat.read(root/name, as_version=4)
    nbformat.validate(nb)
    codes = [c.source for c in nb.cells if c.cell_type == 'code']
    for code in codes:
        ast.parse(code)
    for module in ['pipeline.py', 'model_runtime.py']:
        assert (root/module).read_text(encoding='utf-8') in codes, module + ' embedded source drift'
    assert all(c.execution_count is None and c.outputs == [] for c in nb.cells if c.cell_type == 'code')
    print(name + ': nbformat + Python syntax + embedded source parity passed')
