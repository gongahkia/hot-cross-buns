# exact accepted app copied to an inert profile for visual comparison only
import json,pathlib,subprocess,tempfile,plistlib,shutil,os,time
r=pathlib.Path(tempfile.mkdtemp(prefix='hot-cross-buns-native-test-pet-b1-',dir='/tmp'));r.chmod(0o700)
app=r/'HotCrossBuns.app';shutil.copytree('/tmp/HotCrossBuns-Native-P04M-2D.app',app)
p=app/'Contents/Info.plist';info=plistlib.loads(p.read_bytes());info['CFBundleIdentifier']='dev.hot-cross-buns.pet.b1.hot-cross-buns-fixture';p.write_bytes(plistlib.dumps(info))
for k in ['hot-cross-buns.notch.enabled','hot-cross-buns.menuBar.enabled','hot-cross-buns.mascot.shown']:subprocess.run(['defaults','write',info['CFBundleIdentifier'],k,'-bool','true'],check=True)
folder=r/'config/hot-cross-buns';folder.mkdir(parents=True,mode=0o700);config=folder/'config.json';config.write_text(json.dumps({'version':4,'defaults':{'provider':'openai','model':'gpt-5.6'},'provider_endpoints':{'openai':'http://127.0.0.1:9/responses'}}));config.chmod(0o600)
env={'PATH':os.environ['PATH'],'HOME':str(r),'HOT_CROSS_BUNS_NATIVE_USER_DATA':str(r/'native'),'HOT_CROSS_BUNS_NATIVE_WORKSPACE':str(r/'workspace'),'HOT_CROSS_BUNS_STATE_DIR':str(r/'state'),'HOT_CROSS_BUNS_CONFIG_DIR':str(r/'config'),'OPENAI_API_KEY':'inert-fixture-no-provider-call','HOT_CROSS_BUNS_NATIVE_TEST_APPEARANCE':'light','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'}
p=subprocess.Popen([str(app/'Contents/MacOS/HotCrossBunsMac'),'--open-window'],env=env,stdout=open(r/'hot-cross-buns.log','w'),stderr=subprocess.STDOUT)
pathlib.Path('/tmp/hot-cross-buns-pet-b1-hot-cross-buns.json').write_text(json.dumps({'pid':p.pid,'root':str(r),'app':str(app)},indent=2));print(p.pid,flush=True);print(p.wait(),flush=True)
