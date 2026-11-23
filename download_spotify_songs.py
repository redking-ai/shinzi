#!/usr/bin/env python3
import csv
import os
import sys
import subprocess
import time
import re

CSV_PATH = '/sdcard/Music/Liked_Songs.csv'
MUSIC_DIR = '/sdcard/Music/Spotify_Liked'
LOG_PATH = '/sdcard/Music/download_progress.log'

os.makedirs(MUSIC_DIR, exist_ok=True)

def sanitize(name):
    return re.sub(r'[\\/*?:"<>|]', "", name).strip()

def log(msg):
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{timestamp}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def get_existing_files():
    try:
        return set(os.listdir(MUSIC_DIR))
    except Exception:
        return set()

def main():
    if not os.path.exists(CSV_PATH):
        log(f"CSV not found at {CSV_PATH}")
        sys.exit(1)

    songs = []
    with open(CSV_PATH, 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            track = row.get('Track Name', '').strip()
            artists = row.get('Artist Name(s)', '').strip()
            if track:
                songs.append((track, artists))

    total = len(songs)
    log(f"Found {total} songs in {CSV_PATH}")

    success_count = 0
    skip_count = 0

    for idx, (track, artists) in enumerate(songs, 1):
        clean_track = sanitize(track)
        clean_artist = sanitize(artists.split(';')[0]) if artists else ""
        expected_base = f"{clean_artist} - {clean_track}" if clean_artist else clean_track
        
        # Check if already downloaded
        existing = get_existing_files()
        already_downloaded = False
        for fname in existing:
            if clean_track.lower() in fname.lower() and (fname.endswith('.mp3') or fname.endswith('.m4a')):
                already_downloaded = True
                break
        
        if already_downloaded:
            skip_count += 1
            log(f"[{idx}/{total}] Already exists: {expected_base}")
            continue

        search_query = f"ytsearch1:{track} {artists} audio"
        output_template = os.path.join(MUSIC_DIR, f"{expected_base}.%(ext)s")

        log(f"[{idx}/{total}] Downloading: {track} by {artists}...")

        cmd = [
            'yt-dlp',
            '--no-playlist',
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '5',
            '--embed-thumbnail',
            '--add-metadata',
            '--output', output_template,
            '--quiet',
            '--no-warnings',
            search_query
        ]

        try:
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
            if res.returncode == 0:
                success_count += 1
                log(f"[{idx}/{total}] Completed: {expected_base}")
            else:
                log(f"[{idx}/{total}] Failed (exit code {res.returncode}): {expected_base}")
        except subprocess.TimeoutExpired:
            log(f"[{idx}/{total}] Timeout: {expected_base}")
        except Exception as e:
            log(f"[{idx}/{total}] Error: {expected_base} - {e}")

        # Sleep 1.5 seconds between songs to prevent CPU overheating & rate-limiting
        time.sleep(1.5)

    log(f"All done! Total: {total}, Downloaded: {success_count}, Skipped: {skip_count}")

if __name__ == '__main__':
    main()
