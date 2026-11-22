import json,os,pathlib,subprocess
m=json.load(open('/tmp/hot-cross-buns-p03-acceptance.json'));pid=str(m['pid']);ctl='/tmp/hot-cross-buns-p03-acceptance-control';base=pathlib.Path('macos/parity/evidence/p03-desktop');log=open(base/'return-minimum-cancel.txt','w',buffering=1)
def call(*args):
 p=subprocess.run([ctl,pid,*args],text=True,capture_output=True,timeout=30);log.write(repr(args)+'\n'+p.stdout+p.stderr)
 if p.returncode:raise RuntimeError((args,p.returncode,p.stdout,p.stderr))
 return p.stdout
before=json.load(open(m['archive']));pids=subprocess.check_output(['pgrep','-P',pid],text=True).split()
call('press','menu','Conversation');call('press','menu','Choose Workspace…');call('wait','open-panel','OKButton');call('focus','open-panel');call('escape-key','open-panel');call('state');call('inspect','conversation','hot-cross-buns.composer.text')
after=json.load(open(m['archive']));assert before==after;assert subprocess.check_output(['pgrep','-P',pid],text=True).split()==pids
call('resize','conversation','540','480');frames=call('frames');call('inspect','conversation','Choose Workspace…');call('inspect','conversation','hot-cross-buns.composer.text')
call('press','menu','Conversation');call('press','menu','hot-cross-buns.recent.'+m['aID']);call('wait','conversation','Current workspace: '+os.path.realpath(m['a']));call('inspect','conversation','hot-cross-buns.composer.text')
a=json.load(open(m['archive']));assert a['selectedConversationID']==m['aID'];assert a['drafts']['conversation:'+m['aID']]['text']=='A desktop draft remains with A'
call('press','menu','Conversation');call('press','menu','hot-cross-buns.recent.'+m['bID']);call('wait','conversation','Current workspace: '+json.load(open(base/'accepted-after-b.json'))['source']);call('inspect','conversation','hot-cross-buns.composer.text')
b=json.load(open(m['archive']));assert b['selectedConversationID']==m['bID'];assert b['drafts']['conversation:'+m['bID']]['text']=='B desktop draft remains with B'
assert subprocess.check_output(['pgrep','-P',pid],text=True).split()==pids
call('frames');log.write('PASS Escape cancellation with identical archive; minimum controls and A/B exact-source/draft return; original 3 owner PIDs reused\n');print('PASS return/minimum/cancel')
