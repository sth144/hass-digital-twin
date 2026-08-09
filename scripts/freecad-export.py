"""Export a FreeCAD document to a twin-ready glTF binary.

Runs inside FreeCAD (the GUI binary), because the glTF exporter lives in ImportGui and
is not available to FreeCADCmd. Driven by environment variables so no argument parsing
has to survive FreeCAD's own command line:

    TWIN_SRC      path to the .FCStd document (required)
    TWIN_GLB      path to write the .glb to (required)
    TWIN_ROOMS    optional path to write room bounds as JSON
    TWIN_EXCLUDE  regex of object names to leave out (default '^Roof_')

The document is opened read-only and never saved, so hiding a roof here cannot change
the user's file.
"""

import json
import os
import re
import sys

import FreeCAD
import FreeCADGui
import ImportGui

SRC = os.environ["TWIN_SRC"]
GLB = os.environ["TWIN_GLB"]
ROOMS = os.environ.get("TWIN_ROOMS")
EXCLUDE = re.compile(os.environ.get("TWIN_EXCLUDE") or "^Roof_")

# FreeCAD works in millimetres and Z-up; glTF is metres and Y-up.
MM = 1000.0


def is_exportable(obj):
    """Leaf solids only: groups would drag their whole subtree into the export."""
    return obj.TypeId != "App::DocumentObjectGroup" and hasattr(obj, "Shape")


def is_visible(obj):
    view = getattr(obj, "ViewObject", None)
    return view is None or view.Visibility


def room_bounds(group, exported):
    """XZ bounds of a group's exported members, in twin (glTF) coordinates."""
    box = None
    stack = list(group.OutList)
    while stack:
        child = stack.pop()
        stack.extend(child.OutList)
        if child.Name not in exported or not hasattr(child, "Shape"):
            continue
        shape = child.Shape.BoundBox
        if shape.isValid():
            box = shape if box is None else box.united(shape)
    if box is None:
        return None
    return {
        "x": [box.XMin / MM, box.XMax / MM],
        # Z-up to Y-up flips the sign of Y, so the max becomes the min.
        "z": [-box.YMax / MM, -box.YMin / MM],
    }


def main():
    # The glTF exporter needs the Gui module, but nobody needs to watch it work.
    FreeCADGui.getMainWindow().hide()
    doc = FreeCAD.openDocument(SRC)
    FreeCADGui.updateGui()
    keep, skipped = [], []
    for obj in doc.Objects:
        if not is_exportable(obj):
            continue
        if EXCLUDE.search(obj.Name) or not is_visible(obj):
            skipped.append(obj.Name)
        else:
            keep.append(obj)
    if not keep:
        raise SystemExit("nothing to export: every object was hidden or excluded")
    print("twin-export: exporting %d objects, skipping %d" % (len(keep), len(skipped)))
    print("twin-export: skipped %s" % ", ".join(sorted(skipped)[:12]))
    ImportGui.export(keep, GLB)

    if ROOMS:
        exported = {obj.Name for obj in keep}
        rooms = {}
        for group in doc.Objects:
            if group.TypeId != "App::DocumentObjectGroup":
                continue
            bounds = room_bounds(group, exported)
            if bounds:
                rooms[group.Name] = bounds
        with open(ROOMS, "w") as handle:
            json.dump(rooms, handle, indent=2)
        print("twin-export: wrote bounds for %d groups" % len(rooms))

    FreeCAD.closeDocument(doc.Name)  # never saved: the source document is untouched
    print("twin-export: done")
    sys.stdout.flush()
    FreeCADGui.getMainWindow().close()


main()
