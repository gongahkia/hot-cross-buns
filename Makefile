SHELL := /bin/zsh

ROOT := $(CURDIR)
DEV_PORT ?= 5173

.PHONY: run stop status

run: stop
	@echo "starting dev; use Ctrl-C to stop"
	@trap '' QUIT; pnpm run dev

stop:
	@root="$(ROOT)"; \
	pids=$$( \
		{ \
			ps -axo pid=,command= | awk -v root="$$root" ' \
				index($$0, root "/node_modules/.pnpm/electron@") && index($$0, "/Electron.app/Contents/") { print $$1 } \
				index($$0, root "/node_modules/.pnpm/electron-vite@") { print $$1 } \
				index($$0, root "/node_modules/electron-vite") { print $$1 } \
			'; \
			lsof -nP -tiTCP:$(DEV_PORT) -sTCP:LISTEN 2>/dev/null || true; \
		} | sort -u | tr '\n' ' ' \
	); \
	pid_array=($${=pids}); \
	if (( $${#pid_array[@]} == 0 )); then \
		echo "no existing dev instance"; \
		exit 0; \
	fi; \
	echo "stopping pids: $$pids"; \
	kill -TERM $${pid_array[@]} 2>/dev/null || true; \
	sleep 1; \
	alive=(); \
	for pid in $${pid_array[@]}; do \
		kill -0 "$$pid" 2>/dev/null && alive+=("$$pid"); \
	done; \
	if (( $${#alive[@]} > 0 )); then \
		echo "force stopping pids: $${alive[@]}"; \
		kill -KILL $${alive[@]} 2>/dev/null || true; \
	fi

status:
	@root="$(ROOT)"; \
	output=$$( \
		{ \
			ps -axo pid,ppid,pgid,command | awk -v root="$$root" ' \
				index($$0, root "/node_modules/.pnpm/electron@") && index($$0, "/Electron.app/Contents/") { print } \
				index($$0, root "/node_modules/.pnpm/electron-vite@") { print } \
				index($$0, root "/node_modules/electron-vite") { print } \
			'; \
			lsof -nP -iTCP:$(DEV_PORT) -sTCP:LISTEN 2>/dev/null || true; \
		} \
	); \
	if [[ -z "$$output" ]]; then \
		echo "no existing dev instance"; \
	else \
		print -r -- "$$output"; \
	fi
