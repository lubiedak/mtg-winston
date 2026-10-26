"""Wgrywa draft Winston na Mikrusa, obok lubisoftware.com. Nie kasuje zapisów draftu."""
import os
from pathlib import Path
import sys

import paramiko

ROOT = Path(__file__).resolve().parents[1]
# Dane SSH (MIKRUS_*) są w .env repo lubisoftware; nic nie jest zapisane tutaj.
ENV_PATH = Path(os.environ.get("LUBISOFTWARE_ENV") or Path.home() / "lubisoftware" / ".env")
REMOTE = "/var/www/mtg-winston"
UNIT = "/etc/systemd/system/mtg-winston.service"


def load_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def safe(text: str, secret: str) -> str:
    if secret and secret in text:
        return text.replace(secret, "***")
    return text


def ensure_dir(sftp, path: str) -> None:
    cur = ""
    for part in path.strip("/").split("/"):
        cur += "/" + part
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def should_skip(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if rel.startswith("data/drafts/") or rel.startswith("data/imports/"):
        return True
    if rel.startswith(("results/", "test/", "scripts/", "node_modules/")):
        return True
    name = path.name
    if name.endswith(("-as-text.txt", "-oracle.txt")):
        return True
    if name.startswith("."):
        return True
    return False


def files_to_upload():
    wanted = [
        ROOT / "server.js",
        ROOT / "package.json",
        ROOT / "data" / "cards.json",
        ROOT / "data" / "deck-extras.json",
    ]
    pl = ROOT / "data" / "pl.json"
    if pl.exists():
        wanted.append(pl)
    for folder in (ROOT / "src", ROOT / "public", ROOT / "decki"):
        wanted.extend(item for item in folder.rglob("*") if item.is_file() and not should_skip(item))
    unique = []
    seen = set()
    for item in wanted:
        if should_skip(item) or item in seen or not item.is_file():
            continue
        seen.add(item)
        unique.append(item)
    return unique


def main() -> None:
    if not ENV_PATH.is_file():
        raise SystemExit(f"Brak .env lubisoftware: {ENV_PATH} (ustaw LUBISOFTWARE_ENV)")
    env = load_env(ENV_PATH)
    host = env["MIKRUS_HOST"]
    port = int(env.get("MIKRUS_PORT") or 22)
    user = env.get("MIKRUS_USER") or "root"
    password = env.get("MIKRUS_SSH_PASSWORD") or ""
    print(f"=== MTG -> {user}@{host}:{port} {REMOTE} ===", flush=True)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            port=port,
            username=user,
            password=password or None,
            timeout=30,
            look_for_keys=False,
            allow_agent=False,
        )
    except Exception as err:
        print(safe(f"SSH: {err}", password), file=sys.stderr)
        raise SystemExit(1) from None

    def run(command: str) -> str:
        _, stdout, stderr = client.exec_command(command)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        text = (out + err).strip()
        if code != 0:
            print(safe(text, password))
            raise SystemExit(f"polecenie zwróciło {code}")
        return out

    print(run("df -h / | tail -n 1 && command -v node && node -v && ss -ltnp | grep 8734 || echo port_8734_wolny"))
    files = files_to_upload()
    print(f"plików: {len(files)}", flush=True)
    sftp = client.open_sftp()
    ensure_dir(sftp, REMOTE)
    for index, item in enumerate(files, start=1):
        rel = item.relative_to(ROOT).as_posix()
        remote = f"{REMOTE}/{rel}"
        ensure_dir(sftp, remote.rsplit("/", 1)[0])
        sftp.put(str(item), remote)
        if index % 200 == 0 or index == len(files):
            print(f"  {index}/{len(files)}", flush=True)
    sftp.close()

    node = run("command -v node").strip().splitlines()[-1]
    unit = f"""[Unit]
Description=Winston draft for lubisoftware.com/mtg
After=network.target

[Service]
Type=simple
WorkingDirectory={REMOTE}
ExecStart={node} server.js
Environment=PORT=8734
Restart=on-failure
RestartSec=2
User=www-data
Group=www-data
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
"""
    sftp = client.open_sftp()
    with sftp.file(UNIT, "w") as handle:
        handle.write(unit)
    sftp.close()
    print(run(
        f"chown -R www-data:www-data {REMOTE} && "
        f"mkdir -p {REMOTE}/data/drafts {REMOTE}/data/imports && "
        f"chown -R www-data:www-data {REMOTE}/data {REMOTE}/public/art && "
        "systemctl daemon-reload && systemctl enable --now mtg-winston && "
        "systemctl restart mtg-winston && sleep 0.4 && systemctl is-active mtg-winston && "
        "curl -sS -m 8 -o /dev/null -w 'origin_%{http_code}\\n' http://127.0.0.1:8734/ && "
        "curl -sS -m 8 http://127.0.0.1:8734/ | head -n 12"
    ))
    client.close()
    print("Gotowe na 127.0.0.1:8734. Nginx /mtg wgrywa deploy strony.")


if __name__ == "__main__":
    main()
