# Desktop-only launch of an isolated preference-domain copy.
import json
import pathlib
import plistlib
import subprocess
import sys

metadata = pathlib.Path('/tmp/hot-cross-buns-p02-session.json')
m = json.loads(metadata.read_text()); app = pathlib.Path(m['app'])
assert app == pathlib.Path('/tmp/HotCrossBuns-Native-Parity-P02-Desktop.app')
assert plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleIdentifier'] == 'dev.hot-cross-buns.native.p02-disposable'
mode = sys.argv[1]; assert mode in ['light', 'dark']
log = open(pathlib.Path(m['root']) / ('desktop-' + mode + '.log'), 'w')
p = subprocess.Popen([str(app / 'Contents/MacOS/HotCrossBunsMac'), '--open-window'], env=m['env'] | {'HOT_CROSS_BUNS_NATIVE_TEST_APPEARANCE': mode}, stdout=log, stderr=subprocess.STDOUT)
m['pid'] = p.pid; m['appearance'] = mode; metadata.write_text(json.dumps(m, indent=2))
print(json.dumps({'pid': p.pid, 'appearance': mode, 'profile': m['root']}), flush=True)
print('exit', p.wait(), flush=True)
