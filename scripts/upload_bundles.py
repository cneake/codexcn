#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上传 GenHub 构建产物到服务器并生成 SHA256 校验文件。"""
import hashlib
import os
import paramiko

HOST = "103.52.153.201"
PORT = 22
USER = "root"
PASS = "Ea61091793"
REMOTE_DIR = "/www/wwwroot/agent.eake.cn/wp-content/downloads/"

BASE = r"D:\codexhubcn\cc-switch-clone\src-tauri\target\release\bundle"
FILES = {
    "nsis": os.path.join(BASE, "nsis", "GenHub_0.1.5_x64-setup.exe"),
    "msi": os.path.join(BASE, "msi", "GenHub_0.1.5_x64_zh-CN.msi"),
}


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    local_uploads = []
    for label, local in FILES.items():
        if not os.path.exists(local):
            print(f"[SKIP] {label} 不存在: {local}")
            continue
        digest = sha256_of(local)
        sha_path = local + ".sha256"
        with open(sha_path, "w", encoding="utf-8") as f:
            f.write(digest)
        print(f"[{label}] {os.path.basename(local)} sha256={digest[:16]}...")
        local_uploads.append(local)
        local_uploads.append(sha_path)

    if not local_uploads:
        print("没有可上传的文件，退出。")
        return

    t = paramiko.Transport((HOST, PORT))
    t.connect(username=USER, password=PASS)
    sftp = paramiko.SFTPClient.from_transport(t)
    for local in local_uploads:
        remote = REMOTE_DIR + os.path.basename(local)
        print(f"[UP] {os.path.basename(local)} -> {remote}")
        sftp.put(local, remote)
    sftp.close()
    t.close()
    print("上传完成。")


if __name__ == "__main__":
    main()
