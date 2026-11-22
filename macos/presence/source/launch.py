import json,pathlib,subprocess,sys
p=pathlib.Path('/tmp/hot-cross-buns-presence-session.json');m=json.loads(p.read_text());mode=sys.argv[1];assert mode in ['light','dark']
assert pathlib.Path(m['root']).name.startswith('hot-cross-buns-native-test-presence-')
log=open(pathlib.Path(m['root'])/('app-'+mode+'.log'),'a');proc=subprocess.Popen([str(pathlib.Path(m['app'])/'Contents/MacOS/HotCrossBunsMac'),'--open-window'],env=m['env']|{'HOT_CROSS_BUNS_NATIVE_TEST_APPEARANCE':mode},stdout=log,stderr=subprocess.STDOUT)
m['pid']=proc.pid;m['mode']=mode;p.write_text(json.dumps(m,indent=2));print(json.dumps({'pid':proc.pid,'mode':mode}),flush=True);print('exit',proc.wait(),flush=True)
