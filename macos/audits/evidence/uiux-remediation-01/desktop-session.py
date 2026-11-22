# Run only a disposable-profile copy; it must have a separate preference domain.
import json, pathlib, plistlib, subprocess, sys
metadata=pathlib.Path('/tmp/hot-cross-buns-uiux-remediation-session.json');m=json.loads(metadata.read_text())
app=pathlib.Path(sys.argv[1]);mode=sys.argv[2]
assert app.name in ['HotCrossBuns-Native-UIUX-Preview.app','HotCrossBuns-Native-UIUX-Desktop.app']
plist=app/'Contents/Info.plist';info=plistlib.loads(plist.read_bytes());info['CFBundleIdentifier']='dev.hot-cross-buns.native.uiux-remediation';plist.write_bytes(plistlib.dumps(info))
env=m['env']|{'HOT_CROSS_BUNS_NATIVE_TEST_APPEARANCE':mode}
p=subprocess.Popen([str(app/'Contents/MacOS/HotCrossBunsMac'),'--open-window'],env=env,stdout=open(pathlib.Path(m['root'])/('remediation-'+mode+'.log'),'w'),stderr=subprocess.STDOUT)
m['desktopPID']=p.pid;m['appearance']=mode;metadata.write_text(json.dumps(m,indent=2));print(json.dumps({'pid':p.pid,'app':str(app),'appearance':mode,'profile':m['root']}),flush=True)
print('desktop_exit',p.wait(),flush=True)
