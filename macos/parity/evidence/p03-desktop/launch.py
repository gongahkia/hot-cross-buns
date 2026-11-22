import json,pathlib,plistlib,subprocess,sys
p=pathlib.Path('/tmp/hot-cross-buns-p03-acceptance.json');m=json.loads(p.read_text());app=pathlib.Path(m['app'])
assert str(app) in ['/tmp/HotCrossBuns-Native-Parity-P03-Acceptance-Desktop.app','/tmp/HotCrossBuns-Native-Parity-P03-Accepted-Desktop.app']
assert plistlib.loads((app/'Contents/Info.plist').read_bytes())['CFBundleIdentifier']==m['bundle'] and m['bundle'] in ['dev.hot-cross-buns.native.p03.acceptance','dev.hot-cross-buns.native.p03.acceptance.fixed']
mode=sys.argv[1] if len(sys.argv)>1 else 'light';assert mode in ['light','dark']
log=open(pathlib.Path(m['root'])/('acceptance-'+mode+'.log'),'w')
process=subprocess.Popen([str(app/'Contents/MacOS/HotCrossBunsMac'),'--open-window'],env=m['env']|{'HOT_CROSS_BUNS_NATIVE_TEST_APPEARANCE':mode},stdout=log,stderr=subprocess.STDOUT)
m['pid']=process.pid;m['mode']=mode;p.write_text(json.dumps(m,indent=2));print(json.dumps({'pid':process.pid,'root':m['root']}),flush=True);print('exit',process.wait(),flush=True)
