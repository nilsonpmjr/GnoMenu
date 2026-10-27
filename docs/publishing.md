# Publishing GnoMenu Global Menu

GnoMenu is a community extension under development. It has not been submitted or approved for extensions.gnome.org.

## Project identity

The public repository is [nilsonpmjr/GnoMenu](https://github.com/nilsonpmjr/GnoMenu), and the permanent UUID is `gnomenu@nilsonpmjr.github.io`. The older `gnomenu@nilsonpmjr.local` installation is a development identity.

For a fork, configure a repository and permanent UUID under the new maintainer's control:

```bash
python3 tools/configure-project.py https://github.com/YOUR-ACCOUNT/GnoMenu \
  --uuid gnomenu@YOUR-ACCOUNT.github.io
```

The public display name is **GnoMenu Global Menu**, with **GnoMenu** as the short brand. This distinguishes the project from the existing [Gno-Menu catalog entry](https://extensions.gnome.org/extension/608/gnomenu/). The configuration command preserves the current display name unless `--name` is supplied.

Changing the UUID creates a separate installed extension. Disable the development installation before installing a differently named public UUID. Keep the submitted UUID stable.

## Publish the source on GitHub

The project's `main` branch is already published. To publish a fork, create an empty public repository on GitHub. From the project root, configure its URL and UUID using the command above, then review and commit the source:

```bash
git status --short
git add .
git diff --cached --stat
git commit -m "Prepare GnoMenu Global Menu alpha"
git remote add origin https://github.com/YOUR-ACCOUNT/GnoMenu.git
git push --set-upstream origin HEAD
```

Use your actual repository URL. If `origin` is already configured, inspect it with `git remote -v` and skip `git remote add` when it already points to the right repository. Existing commits can be pushed along with the preparation commit.

The ignore rules exclude local reports, downloaded references, generated catalogs, dependencies and build artifacts. The README, documentation, screenshots, translation sources, license and GitHub Actions workflow belong in the source repository. GitHub Actions runs on push and pull requests; its package is a development artifact until the release checks below are complete.

## Prepare the artifact

```bash
npm ci --ignore-scripts
python3 tools/verify.py
python3 tools/audit-release.py --release
```

The full verifier tests the actual built ZIP in private GNOME sessions, including real Nautilus/Ptyxis windows and pt-BR. The release audit checks archive contents, module availability, catalogs, licensing and public metadata.

Basic input checks use virtual keyboard and pointer devices in the private compositor. They cover menu opening, Up/Down navigation, Return activation, Escape dismissal and a pointer click on an application command. The fixture checks also repeat disable/enable to verify source disposal and panel registration cleanup.

The ZIP includes only runtime JavaScript, metadata, CSS, compiled translation catalogs and COPYING. It excludes test drivers, Python scripts, research modules, node_modules, source PO/POT files and logs.

`version-name` is the project's user-visible pre-release label. The GNOME Extensions site controls its numeric submission version; the source does not set `version`.

## Maintainer review

Read the shipped modules and `docs/architecture.md` before submitting. The maintainer must be able to explain the code and its behavior, including any AI-assisted contributions. Automated checks are evidence, not approval.

Manual checks still required before claiming a release suitable for general use:

- Fresh GNOME 50 login with the ZIP installed.
- Pointer and keyboard navigation between headings and nested menus.
- Interaction with other panel extensions.
- Screen-reader behavior.
- HiDPI, long titles and multiple-monitor arrangements.
- Repeated enable/disable and recovery from application termination.
- Correct compatibility claims and partial-menu labeling.

Do not advertise Signal, Obsidian, Firefox or complete Nautilus/Ptyxis menus as supported until their integration is demonstrated.

## Submit

Create a GNOME Extensions account and upload the exact audited ZIP through the site's extension upload flow. Use an accurate description, public support URL and clean screenshots. Respond to reviewer questions and retest any changes before resubmission.

No tool in this repository uploads to GNOME Extensions, creates a public GitHub release or changes an existing listing automatically.

Official references:

- [Review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [Extension metadata and ZIP structure](https://gjs.guide/extensions/overview/anatomy.html)
- [GNOME Extensions](https://extensions.gnome.org/)

The local audit reflects these references as checked on October 26, 2026. Review decisions remain with GNOME Extensions reviewers.
