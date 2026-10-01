#!/usr/bin/env bash
# Build Riwaq the way F-Droid will, inside F-Droid's own build image, and
# check that the result is byte-identical to our release APK.
#
# Run by .github/workflows/fdroid-verify.yml as
#
#   docker run -v "$PWD:/src" -v "$OUT:/out" \
#     registry.gitlab.com/fdroid/fdroidserver:buildserver-trixie \
#     bash /src/scripts/fdroid-verify-in-container.sh
#
# with /out/release.apk holding the APK to compare against.
#
# The steps follow the `fdroid build` job in fdroiddata's .gitlab-ci.yml,
# which is what builds a merge request there: same image, same `vagrant`
# user and /home/vagrant paths, JDK 21, `fdroid build --on-server`. The
# recipe is docs/fdroid/com.riwaq.reader.yml with its version and commit
# pointed at the checkout being tested, and without `Binaries:`, because a
# draft release's APK has no public URL for fdroidserver to fetch; the
# comparison it would make is done here instead, with apksigcopier.
#
# Exit status 0 means F-Droid would ship our signed APK for this commit.

set -euxo pipefail

appid=com.riwaq.reader
home_vagrant=/home/vagrant
export ANDROID_HOME=/opt/android-sdk

# The checkout is mounted from the runner, owned by another uid.
git config --global --add safe.directory '*'

commit="$(git -C /src rev-parse HEAD)"
version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' /src/package.json)"
IFS=. read -r major minor patch <<<"$version"
vercode=$((major * 1000000 + minor * 1000 + patch))

apt-get update
apt-get install -y sudo git openjdk-21-jdk-headless apksigcopier apksigner unzip
update-alternatives --set java /usr/lib/jvm/java-21-openjdk-amd64/bin/java

# fdroidserver from git, as fdroiddata's CI installs it.
fdroidserver=/opt/fdroidserver
git clone --depth 1 https://gitlab.com/fdroid/fdroidserver.git "$fdroidserver"
git -C "$home_vagrant/gradlew-fdroid" pull || true

# fdroidserver builds from the source repo named in the recipe; point it at
# this checkout so an unpushed or PR commit can be tested.
work=/work/fdroiddata
git clone --depth 1 https://gitlab.com/fdroid/fdroiddata.git "$work"
python3 - "$work/metadata/$appid.yml" "$version" "$vercode" "$commit" <<'PY'
import re, sys
out, version, vercode, commit = sys.argv[1:]
s = open("/src/docs/fdroid/com.riwaq.reader.yml").read()
s = re.sub(r"(?m)^Binaries:.*\n", "", s)
s = re.sub(r"(?m)^Repo: .*$", "Repo: /src", s)
s = re.sub(r"(?m)^(  - versionName: ).*$", r"\g<1>" + version, s)
s = re.sub(r"(?m)^(    versionCode: ).*$", r"\g<1>" + vercode, s)
s = re.sub(r"(?m)^(    commit: ).*$", r"\g<1>" + commit, s)
s = re.sub(r"(?m)^CurrentVersion: .*$", "CurrentVersion: " + version, s)
s = re.sub(r"(?m)^CurrentVersionCode: .*$", "CurrentVersionCode: " + vercode, s)
open(out, "w").write(s)
PY
sudo -u vagrant git config --global --add safe.directory '*'

cd "$work"
for d in logs tmp unsigned build "$home_vagrant/.android" "$home_vagrant/.gradle" "$home_vagrant/metadata"; do
  mkdir -p "$d"
  chown -R vagrant "$d"
done
ln -sfn "$work/tmp" "$home_vagrant/tmp"
ln -sfn "$work/srclibs" "$home_vagrant/srclibs"
cp "metadata/$appid.yml" "$home_vagrant/metadata/"
cp -R build "$home_vagrant/build"
chown -R vagrant "$home_vagrant" "$work" /src

export GRADLE_USER_HOME=$home_vagrant/.gradle
fdroid=(sudo --preserve-env --user vagrant
  env PATH="$fdroidserver:$PATH"
  PYTHONPATH="$fdroidserver:$fdroidserver/examples"
  PYTHONUNBUFFERED=true
  HOME="$home_vagrant"
  fdroid)

cd "$home_vagrant"
ln -sfn "$work" "$home_vagrant/fdroiddata"
"${fdroid[@]}" fetchsrclibs "$appid:$vercode" --verbose
rm "$home_vagrant/fdroiddata"
(unset CI; "${fdroid[@]}" build --verbose --test --refresh-scanner --on-server --no-tarball "$appid:$vercode")

built="$work/tmp/${appid}_${vercode}.apk"
cp "$built" /out/fdroid-unsigned.apk

# The check F-Droid makes: copy our release signature onto its build. If the
# signature then verifies, the two APKs are the same bytes where it counts.
if apksigcopier compare /out/release.apk --unsigned /out/fdroid-unsigned.apk; then
  echo "REPRODUCIBLE: F-Droid's build of $commit matches the release APK"
else
  echo "NOT REPRODUCIBLE: entries that differ:"
  python3 - /out/release.apk /out/fdroid-unsigned.apk <<'PY' | tee /out/differences.txt
import hashlib, sys, zipfile
a, b = (zipfile.ZipFile(p) for p in sys.argv[1:])
def digests(z):
    return {i.filename: hashlib.sha256(z.read(i)).hexdigest()
            for i in z.infolist() if not i.filename.startswith("META-INF/")}
da, db = digests(a), digests(b)
for name in sorted(set(da) | set(db)):
    if da.get(name) != db.get(name):
        print(f"  {name}: release={da.get(name, 'missing')[:12]} fdroid={db.get(name, 'missing')[:12]}")
PY
  exit 1
fi
