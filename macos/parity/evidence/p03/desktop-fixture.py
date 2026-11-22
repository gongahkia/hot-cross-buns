# Explicit disposable fixture; no live Hot Cross Buns profile or provider is read.
import hashlib, json, os, pathlib, plistlib, shutil, subprocess, tempfile, uuid, time
root = pathlib.Path(tempfile.mkdtemp(prefix='hot-cross-buns-native-test-p03-', dir='/tmp'))
helper = root / 'seed-catalog'
subprocess.run(['go','build','-o',str(helper),'macos/Tests/HotCrossBunsCoreTests/Fixtures/native-catalog-seed.go'],check=True)
ids = json.loads(subprocess.check_output([str(helper),str(root),'6'],text=True))
(root/'config/hot-cross-buns').mkdir(parents=True)
(root/'config/hot-cross-buns/config.json').write_text(json.dumps({'version':4,'defaults':{'provider':'fixture','model':'fixture'},'custom_providers':[{'id':'fixture','base_url':'http://127.0.0.1:9/chat','models':['fixture'],'default_model':'fixture'}]}))
for name in ['Project café 日本 with spaces','Another selected workspace']:
 (root/name).mkdir(mode=0o700)
(root/'project-link').symlink_to(root/'Project café 日本 with spaces',target_is_directory=True)
env={'PATH':os.environ['PATH'],'HOME':str(root),'HOT_CROSS_BUNS_NATIVE_USER_DATA':str(root/'native'),'HOT_CROSS_BUNS_NATIVE_WORKSPACE':str(root/'workspace'),'HOT_CROSS_BUNS_CONFIG_DIR':str(root/'config'),'HOT_CROSS_BUNS_STATE_DIR':str(root/'state'),'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','HOT_CROSS_BUNS_NATIVE_TEST_APPEARANCE':'light'}
archive=root/'native/native/drafts';archive.mkdir(parents=True,mode=0o700)
path=archive/(hashlib.sha256(str(root/'state').encode()).hexdigest()+'.json')
path.write_text(json.dumps({'version':1,'selectedConversationID':ids[-1],'drafts':{'conversation:'+ids[-1]:{'text':'Unsent original workspace draft','revision':str(uuid.uuid4()),'updated':time.time()-978307200}}}));path.chmod(0o600)
app=pathlib.Path('/tmp/HotCrossBuns-Native-Parity-P03-Desktop.app');assert not app.exists()
shutil.copytree('/tmp/HotCrossBuns-Native-Parity-P03.app',app)
p=app/'Contents/Info.plist';info=plistlib.loads(p.read_bytes());info['CFBundleIdentifier']='dev.hot-cross-buns.native.p03-disposable';p.write_bytes(plistlib.dumps(info))
for key in ['hot-cross-buns.notch.enabled','hot-cross-buns.menuBar.enabled']:
 subprocess.run(['/usr/bin/defaults','write',info['CFBundleIdentifier'],key,'-bool','false'],check=True)
metadata={'root':str(root),'ids':ids,'helper':str(helper),'env':env,'app':str(app),'bundle':info['CFBundleIdentifier']}
pathlib.Path('/tmp/hot-cross-buns-p03-session.json').write_text(json.dumps(metadata,indent=2))
print(json.dumps({'root':str(root),'original':ids[-1]}))
