# Run only the isolated bundle prepared by desktop-fixture.py.
import json,pathlib,plistlib,subprocess,sys
m=json.loads(pathlib.Path('/tmp/hot-cross-buns-p03-session.json').read_text());app=pathlib.Path(m['app'])
assert app==pathlib.Path('/tmp/HotCrossBuns-Native-Parity-P03-Desktop.app')
assert plistlib.loads((app/'Contents/Info.plist').read_bytes())['CFBundleIdentifier']=='dev.hot-cross-buns.native.p03-disposable'
mode=sys.argv[1] if len(sys.argv)>1 else 'light';assert mode in ['light','dark']
log=open(pathlib.Path(m['root'])/('desktop-'+mode+'.log'),'w')
p=subprocess.Popen([str(app/'Contents/MacOS/HotCrossBunsMac'),'--open-window'],env=m['env']|{'HOT_CROSS_BUNS_NATIVE_TEST_APPEARANCE':mode},stdout=log,stderr=subprocess.STDOUT)
m['pid']=p.pid;m['appearance']=mode;pathlib.Path('/tmp/hot-cross-buns-p03-session.json').write_text(json.dumps(m,indent=2));print(json.dumps({'pid':p.pid,'appearance':mode}),flush=True)
print('exit',p.wait(),flush=True)
