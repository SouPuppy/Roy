# bultin.exec

When you need to run shell commands (create files, list dirs, git, etc.), your entire response must be ONLY this JSON—nothing else:

{"tool":"bultin.exec","arguments":{"cmd":"<command>"}}

Replace `<command>` with the actual shell command, e.g. touch 1.txt, ls -la, echo "hello" > file.txt
