"""Run transport-independent Java unit tests without Android or Bluetooth access."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
java_home = os.environ.get('JAVA_HOME')
def executable(name):
    return str(Path(java_home) / 'bin' / name) if java_home else name
sources = []
for source in (root / 'android/app/src/main/java/local/r2controller').glob('*.java'):
    text = source.read_text()
    if not any(package in text for package in ('android.', 'androidx.', 'com.facebook.')):
        sources.append(source)
tests = sorted((root / 'test/android/native').glob('*Test.java'))
if not tests:
    raise SystemExit('No native unit tests found')
with tempfile.TemporaryDirectory(prefix='mech-java-unit-') as output:
    subprocess.run([executable('javac'), '-d', output, *map(str, sources), *map(str, tests)], check=True)
    for test in tests:
        package = re.search(r'^package\s+([\w.]+);', test.read_text(), re.M)
        name = (package[1] + '.' if package else '') + test.stem
        subprocess.run([executable('java'), '-cp', output, name], check=True)
print(f'{len(tests)} Java unit test programs passed')
