# BookClaw test-build watcher (Mercury)

Rebuilds the BookClaw Docker image on **Mercury** from the current working
tree and (re)starts the standard `bookclaw` container on port `3847`,
triggered by a sentinel file. Lets you redeploy a test instance from any
machine that shares this repo over NFS, without SSHing in to run Docker.

## How it works

1. You finish a round of changes (from any workstation — the files land on
   Mercury's local disk via the NFS export) and run:

   ```bash
   touch build_now        # in the repo root
   ```

2. `bookclaw-build.timer` fires `bookclaw-build.service` once a minute.
   The service runs [`scripts/build-watch.sh`](../build-watch.sh), which:
   - does nothing unless `build_now` exists;
   - consumes the sentinel up front (a slow build is never re-triggered);
   - rebuilds the image and runs `docker compose up -d` via
     [`scripts/deploy.sh`](../deploy.sh), reusing the stable vault key from
     `.env` so the persisted vault stays decryptable;
   - writes build output to `.build-logs/` (gitignored).

If a build fails, `touch build_now` again to retry.

## Checking results

```bash
cat  .build-logs/last-build.status     # one line: timestamp, commit, PASS/FAIL
less .build-logs/latest.log            # full output of the most recent build
systemctl status bookclaw-build      # last run's exit status (FAIL builds show here)
docker compose -f docker/docker-compose.yml ps    # is the container up?
```

## Install (on Mercury — needs sudo, one time)

```bash
cd /home/paul/data/dev/bookclaw
sudo cp scripts/systemd/bookclaw-build.service /etc/systemd/system/
sudo cp scripts/systemd/bookclaw-build.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bookclaw-build.timer
```

Verify:

```bash
systemctl list-timers bookclaw-build.timer   # shows next scheduled run
touch build_now                                # trigger a build
sleep 75 && cat .build-logs/last-build.status  # should report PASS
```

## Uninstall

```bash
sudo systemctl disable --now bookclaw-build.timer
sudo rm /etc/systemd/system/bookclaw-build.{service,timer}
sudo systemctl daemon-reload
```

## Notes

- The units run as user `paul` (in the `docker` group), working directory
  pinned to this repo. Paths are absolute — if the repo ever moves, update
  both unit files and re-run `daemon-reload`.
- This builds the **live working tree**, including uncommitted edits — the
  build reflects exactly what's on disk, not the last commit or `origin`.
- The image is built locally on Mercury; nothing is pushed or pulled over
  the network (no registry, no `docker save`/`load`).
