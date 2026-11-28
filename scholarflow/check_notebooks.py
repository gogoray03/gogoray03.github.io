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
    expected_packages = [s for s in (root/'requirements-colab.txt').read_text().splitlines() if s and not s.startswith('#')]
    setup_calls = [n for code in codes for n in ast.walk(ast.parse(code)) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'setup_worker']
    assert len(setup_calls) == 1, 'missing or duplicate setup_worker call'
    assert ast.literal_eval(setup_calls[0].args[0]) == expected_packages, 'notebook dependency pin drift'
    embedded = {}
    for code in codes:
        for node in ast.walk(ast.parse(code)):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == 'write_text' and isinstance(node.func.value, ast.Call)
                    and isinstance(node.func.value.func, ast.Name) and node.func.value.func.id == 'Path'):
                path = ast.literal_eval(node.func.value.args[0])
                if path.endswith('.py'):
                    source = ast.literal_eval(node.args[0])
                    ast.parse(source)
                    embedded[path] = source
    for module in ['pipeline.py', 'model_runtime.py', 'colab_environment.py', 'extract_uploads.py']:
        assert (root/module).read_text(encoding='utf-8') == embedded[module], module + ' embedded source drift'
    assert all(c.execution_count is None and c.outputs == [] for c in nb.cells if c.cell_type == 'code')
    print(name + ': nbformat + Python syntax + embedded source parity passed')
