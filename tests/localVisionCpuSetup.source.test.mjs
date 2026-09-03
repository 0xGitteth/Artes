import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vision-service/setup_cpu_poc.sh', import.meta.url), 'utf8');
const requirements = readFileSync(new URL('../vision-service/requirements.txt', import.meta.url), 'utf8');

test('vision setup installs only inside a local venv', () => {
  assert.match(source, /VENV_DIR="\.venv"/);
  assert.match(source, /"\$PYTHON_BIN" -m venv "\$VENV_DIR"/);
  assert.match(source, /VENV_PYTHON="\$VENV_DIR\/bin\/python"/);
  assert.doesNotMatch(source, /sudo\s+/);
});

test('vision setup forces CPU-only PyTorch and Torchvision before normal requirements', () => {
  const cpuIndex = source.indexOf('https://download.pytorch.org/whl/cpu');
  const requirementsInstall = source.indexOf('-r requirements.txt');
  assert.notEqual(cpuIndex, -1);
  assert.notEqual(requirementsInstall, -1);
  assert.ok(cpuIndex < requirementsInstall);
  assert.match(source, /--no-cache-dir/);
  assert.match(source, /'torch>=2\.2,<3'/);
  assert.match(source, /'torchvision>=0\.17,<1'/);
  assert.match(requirements, /^torchvision>=0\.17,<1$/m);
  assert.match(source, /torchvisionVersion/);
  assert.match(source, /torchCudaAvailable/);
  assert.match(source, /expectedDevice.*cpu/);
});
