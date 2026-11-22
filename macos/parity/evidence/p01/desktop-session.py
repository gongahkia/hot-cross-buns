# Launch only the isolated preference-domain copy of the verified candidate.
import json
import pathlib
import plistlib
import subprocess
import sys

path = pathlib.Path('/tmp/hot-cross-buns-p01-session.json')
metadata = json.loads(path.read_text())
app = pathlib.Path(metadata['app'])
assert app == pathlib.Path('/tmp/HotCrossBuns-Native-Parity-P01-Desktop.app')
assert plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleIdentifier'] == 'dev.hot-cross-buns.native.p01-disposable'
mode = sys.argv[1]
assert mode in ['light', 'dark']
log = open(pathlib.Path(metadata['root']) / ('candidate-' + mode + '.log'), 'w')
process = subprocess.Popen([str(app / 'Contents/MacOS/HotCrossBunsMac'), '--open-window'], env=metadata['env'] | {'HOT_CROSS_BUNS_NATIVE_TEST_APPEARANCE': mode}, stdout=log, stderr=subprocess.STDOUT)
metadata['pid'] = process.pid
metadata['appearance'] = mode
path.write_text(json.dumps(metadata, indent=2))
print(json.dumps({'pid': process.pid, 'appearance': mode, 'profile': metadata['root']}), flush=True)
print('exit', process.wait(), flush=True)
