#!/usr/bin/env node
/**
 * One command from a FreeCAD document to a live twin on Home Assistant:
 *
 *   node scripts/publish-twin.mjs ~/path/Lot6_House.FCStd
 *
 * Exports a roofless .glb through FreeCAD, publishes it under a content-hashed name,
 * optionally refreshes the room outlines from the document's Room_* groups, builds the
 * frontend, and rsyncs the integration to the Home Assistant host. Runs from any
 * directory: every path is resolved against this file.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import yaml from "js-yaml";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Block style for the structure, flow style for coordinate lists. */
const YAML_STYLE = { lineWidth: 120, flowLevel: 3, quotingType: '"' };
const DEFAULTS = {
  host: "pi@192.168.1.243",
  dest: "/home/pi/Projects/home-assistant/config/custom_components/hass_digital_twin/",
  exclude: "^Roof_",
  freecad: "/Applications/FreeCAD.app/Contents/MacOS/FreeCAD",
};

function parseArgs(argv) {
  const options = { ...DEFAULTS, rooms: false, build: true, deploy: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rooms") options.rooms = true;
    else if (arg === "--no-build") options.build = false;
    else if (arg === "--no-deploy") options.deploy = false;
    else if (arg.startsWith("--")) options[arg.slice(2)] = argv[++i];
    else rest.push(arg);
  }
  options.document = rest[0];
  return options;
}

const USAGE = `Usage: publish-twin.mjs <document.FCStd> [options]

  --id <id>          twin id (default: document name, lower_snake_case)
  --name <name>      twin label shown in the panel (default: document name)
  --exclude <regex>  objects to leave out of the export (default: ${DEFAULTS.exclude})
  --rooms            replace the twin's areas with the document's Room_*/Yard_* groups,
                     keeping the Home Assistant link of any room that still exists
  --host <ssh>       Home Assistant host (default: ${DEFAULTS.host})
  --dest <path>      integration directory on that host
  --freecad <path>   FreeCAD binary (needs the GUI build; the console one has no
                     glTF exporter)
  --no-build         skip 'npm run build'
  --no-deploy        skip the rsync to Home Assistant
`;

const options = parseArgs(process.argv.slice(2));
if (!options.document) {
  process.stderr.write(USAGE);
  process.exit(1);
}

const documentPath = resolve(options.document.replace(/^~/, process.env.HOME ?? "~"));
if (!existsSync(documentPath)) fail(`no such document: ${documentPath}`);
if (!existsSync(options.freecad)) fail(`no FreeCAD at ${options.freecad} (pass --freecad)`);

const documentName = basename(documentPath).replace(/\.FCStd$/i, "");
const twinId = options.id ?? documentName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const twinName = options.name ?? documentName.replace(/[_-]+/g, " ");

function fail(message) {
  process.stderr.write(`publish-twin: ${message}\n`);
  process.exit(1);
}
function step(message) {
  process.stdout.write(`\n▶ ${message}\n`);
}
function run(command, args, extra = {}) {
  execFileSync(command, args, { stdio: "inherit", cwd: REPO, ...extra });
}

// 1. Export the model through FreeCAD.
const work = join(tmpdir(), `twin-${twinId}`);
mkdirSync(work, { recursive: true });
const glbPath = join(work, `${documentName}.glb`);
const roomsPath = join(work, "rooms.json");
step(`Exporting ${documentName} via FreeCAD (runs with its window hidden)`);
run(options.freecad, [join(REPO, "scripts", "freecad-export.py")], {
  env: {
    ...process.env,
    TWIN_SRC: documentPath,
    TWIN_GLB: glbPath,
    TWIN_ROOMS: roomsPath,
    TWIN_EXCLUDE: options.exclude,
  },
});
if (!existsSync(glbPath)) fail("FreeCAD did not produce a .glb (see the log above)");

// 2. Publish the model under a content-hashed name. /models is served with far-future
// cache headers, so the URL has to change whenever the bytes do.
const modelDir = join(REPO, "public", "models");
mkdirSync(modelDir, { recursive: true });
const digest = createHash("sha256").update(readFileSync(glbPath)).digest("hex").slice(0, 8);
const hashedFile = `${documentName}.${digest}.glb`;
copyFileSync(glbPath, join(modelDir, hashedFile));
for (const stale of readdirSync(modelDir))
  if (stale.startsWith(`${documentName}.`) && stale !== hashedFile)
    rmSync(join(modelDir, stale), { force: true });
const megabytes = (statSync(join(modelDir, hashedFile)).size / 1e6).toFixed(1);
const modelUrl = `/hass_digital_twin/models/${hashedFile}`;
step(`Model → public/models/${hashedFile} (${megabytes} MB, immutable URL)`);

// 3. Create or refresh the twin's mapping.
const mappingPath = join(REPO, "public", `${twinId}.yaml`);
const mapping = existsSync(mappingPath)
  ? yaml.load(readFileSync(mappingPath, "utf8"))
  : { model: modelUrl, background: "#131a24", areas: {}, entities: {} };
mapping.model = modelUrl;
if (options.rooms || !Object.keys(mapping.areas ?? {}).length) {
  const before = Object.keys(mapping.areas ?? {}).length;
  mapping.areas = buildAreas(JSON.parse(readFileSync(roomsPath, "utf8")), mapping.areas ?? {});
  step(`Rooms: ${before} → ${Object.keys(mapping.areas).length} from the document's groups`);
}
mapping.entities ??= {};
writeFileSync(mappingPath, yaml.dump(mapping, YAML_STYLE));

// 4. Make sure the twin is listed, as the default.
const catalogPath = join(REPO, "public", "twins.yaml");
// twins.yaml is gitignored (it names real houses), so seed it from the committed example.
const catalogSeed = existsSync(catalogPath)
  ? catalogPath
  : join(REPO, "public", "twins.example.yaml");
const catalog = yaml.load(readFileSync(catalogSeed, "utf8"));
// A name already in the catalog wins unless --name says otherwise, so re-publishing
// does not undo a twin that was renamed by hand.
const listed = catalog.twins.find((twin) => twin.id === twinId);
catalog.twins = [
  {
    id: twinId,
    name: options.name ?? listed?.name ?? twinName,
    mapping: `/hass_digital_twin/${twinId}.yaml`,
  },
  ...catalog.twins.filter((twin) => twin.id !== twinId),
];
writeFileSync(catalogPath, yaml.dump(catalog, { lineWidth: 100 }));

// 5. Build and ship.
if (options.build) {
  step("Building the frontend");
  run("npm", ["run", "build"]);
}
if (options.deploy) {
  step(`Deploying to ${options.host}`);
  run("rsync", [
    "-av",
    "--delete",
    join(REPO, "custom_components", "hass_digital_twin") + "/",
    `${options.host}:${options.dest}`,
  ]);
}
rmSync(work, { recursive: true, force: true });
step(`Done. "${twinName}" is the default twin; reload the panel to see it.`);

/** Turns Room_MasterBedroom bounds into a mapping area, keeping anything already set. */
function buildAreas(rooms, existing) {
  const areas = {};
  for (const [group, bounds] of Object.entries(rooms)) {
    // Only Room_/Yard_ groups are rooms; Structure and friends hold walls and roofs.
    if (!/^(Room|Yard|Area)_/.test(group)) continue;
    const id = group
      .replace(/^(Room|Yard|Area)_/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    const key = group.startsWith("Yard_") ? `${id}_yard` : id;
    const [x0, x1] = bounds.x;
    const [z0, z1] = bounds.z;
    const previous = existing[key] ?? {};
    areas[key] = {
      ...(previous.ha_area_id ? { ha_area_id: previous.ha_area_id } : {}),
      objects: previous.objects ?? [],
      polygon: round([
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ]),
      camera: overheadCamera(x0, x1, z0, z1),
    };
  }
  return areas;
}

function overheadCamera(x0, x1, z0, z1) {
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  const span = Math.max(x1 - x0, z1 - z0);
  return {
    position: round1([cx, 6 + span * 0.6, cz + 4 + span * 0.5]),
    target: round1([cx, 0.5, cz]),
  };
}
function round(points) {
  return points.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]);
}
function round1(values) {
  return values.map((value) => +value.toFixed(1));
}
