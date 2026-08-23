import json
import os
import re
import sys
import uuid
import requests
from pathlib import Path
from stashapi.stashapp import StashInterface
import stashapi.log as log

s = requests.Session()

def scrapePerformer(name, page=1):
    r = s.get(f"https://www.porngals4.com/{name}/{page}")
    re_match_search = re.compile(r'<div class="item">\s*<div class="img">\s*<a href="(/%s.+?)" .+?>' % name)
    return re_match_search.findall(r.text)

def getGallery(path, name):
    r = s.get(f"https://www.porngals4.com{path}")
    re_match_search = re.compile(r'<a href="(https:\/\/b\..+?)"')
    match = re_match_search.findall(r.text)
    return [img for img in match if name in img]

def slugify(name):
    return "-".join(name.split(" ")).lower()

def processPerformer(stash, path, tag_id, performer):
    performer_id = performer["id"]
    slug = slugify(performer["name"])

    performer_dir = Path(path) / str(performer_id)
    performer_dir.mkdir(parents=True, exist_ok=True)
    (performer_dir / ".nogallery").touch()

    index_file = performer_dir / "index.json"
    index = json.loads(index_file.read_text()) if index_file.exists() else {
        "files": {}, "galleries": {}, "performer_id": performer_id
    }

    endpoint_key = "porngals4"
    modified = False
    if endpoint_key not in index["galleries"]:
        gal = stash.create_gallery({
            "title": f"{performer['name']} - porngals4",
            "urls": [f"https://www.porngals4.com/{slug}"],
            "tag_ids": [tag_id],
            "performer_ids": [performer_id],
        })
        log.info(f"Created gallery {gal}")
        index["galleries"][endpoint_key] = gal
        modified = True
    elif stash.find_gallery(index["galleries"][endpoint_key]) is None:
        gal = stash.create_gallery({
            "title": f"{performer['name']} - porngals4",
            "urls": [f"https://www.porngals4.com/{slug}"],
            "tag_ids": [tag_id],
            "performer_ids": [performer_id],
        })
        log.info(f"Re-created gallery {gal}")
        index["galleries"][endpoint_key] = gal
        modified = True

    galleries = scrapePerformer(slug)
    downloaded = 0
    for gallery in galleries:
        for image_url in getGallery(gallery, slug):
            image_id = str(uuid.uuid4())
            image_index = performer_dir / f"{image_id}.json"
            filename = performer_dir / f"{image_id}.jpg"
            if filename.exists():
                continue
            image_data = {
                "title": f"{performer['name']} - porngals4",
                "urls": [image_url],
                "performer_ids": [performer_id],
                "tag_ids": [tag_id],
                "gallery_ids": [index["galleries"][endpoint_key]],
            }
            with open(image_index, "w") as f:
                json.dump(image_data, f)
            r = s.get(image_url)
            with open(filename, "wb") as f:
                f.write(r.content)
            downloaded += 1

    if modified:
        with open(index_file, "w") as f:
            json.dump(index, f)

    log.info(f"{performer['name']}: downloaded {downloaded} new porngals4 image(s)")


def main():
    json_input = json.loads(sys.stdin.read())
    stash = StashInterface(json_input["server_connection"])

    config = stash.get_configuration()["plugins"]
    # Reuse performerGallerySync's own download path - single source of truth,
    # both plugins write into the exact same shared folder/tag/gallery system.
    gallery_sync_settings = config.get("performerGallerySync", {})
    path = gallery_sync_settings.get("path")
    if not path:
        log.error("performerGallerySync's 'path' setting is not configured - set a download folder there first")
        return

    tag_id = stash.find_tag("[Performer Gallery Sync]", create=True).get("id")

    # Opt-in via the same tag performerGallerySync uses, consistent with the
    # rest of the shared system - this does NOT scrape every performer by
    # default the way the original plugin did.
    performers = stash.find_performers(f={
        "tags": {"depth": 0, "excludes": [], "modifier": "INCLUDES_ALL", "value": [tag_id]}
    })

    total = len(performers)
    for index, performer in enumerate(performers, start=1):
        log.progress(index / total if total else 1)
        processPerformer(stash, path, tag_id, performer)

    stash.metadata_scan(paths=[path])


if __name__ == "__main__":
    main()
