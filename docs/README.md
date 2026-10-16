# Documentation

The [GitHub Wiki](https://github.com/edriste/Forkcast/wiki) contains user and administrator guides. This folder keeps [development instructions](development.md), the required [cuisine-data license](licenses/osm-id-tagging-schema.txt), and the wiki's source pages.

## Wiki pages

Start with [Home](wiki/Home.md), or open:

- [Using Forkcast](wiki/Using-Forkcast.md) and [phone installation](wiki/Install-on-your-phone.md)
- [Cloudflare + Supabase](wiki/Cloudflare-and-Supabase.md) or [self-hosting](wiki/Self-hosting.md)
- [Authentication](wiki/Authentication.md), [maps and location](wiki/Maps-and-location.md), and [device notifications](wiki/Device-notifications.md)
- [Maintenance](wiki/Maintenance.md), [troubleshooting](wiki/Troubleshooting.md), and [architecture](wiki/Architecture.md)

## Edit and publish

Edit `docs/wiki/*.md` here so documentation changes can be reviewed with the code. GitHub's wiki is a separate Git repository; merging the app repository does **not** publish these pages.

After creating the wiki's first page on GitHub, publish from the Forkcast checkout:

```sh
FORKCAST_WIKI_DIR=$(mktemp -d)
git clone git@github.com:edriste/Forkcast.wiki.git "$FORKCAST_WIKI_DIR"
cp docs/wiki/*.md "$FORKCAST_WIKI_DIR/"
git -C "$FORKCAST_WIKI_DIR" add -- '*.md'
git -C "$FORKCAST_WIKI_DIR" diff --cached
# Review the changes before publishing:
git -C "$FORKCAST_WIKI_DIR" commit -m "Update Forkcast documentation"
git -C "$FORKCAST_WIKI_DIR" push
```

If you edit the wiki directly on GitHub, copy those changes back here before the next publication. Retired pages must also be removed from the wiki checkout deliberately; copying files alone does not delete them. See [GitHub's wiki instructions](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages).
