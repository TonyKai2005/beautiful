#!/usr/bin/env python3
"""Generate the e Gain Deployment Corridor Blender master and web GLB.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python tools/generate_blender_scene.py

The scene is authored along Blender +Y. glTF's coordinate conversion presents
that direction as web -Z, matching a browser camera travelling from z=26 toward
z=-58.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "public/assets/3d/egain-corridor.blend"
GLB_PATH = ROOT / "public/assets/3d/egain-corridor.glb"
BALANCED_GLB_PATH = ROOT / "public/assets/3d/egain-corridor-balanced.glb"
POSTER_PATH = ROOT / "public/assets/renders/egain-boot-poster.webp"
FONT_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Black.ttf")
FONT_REGULAR = Path("/System/Library/Fonts/Supplemental/Arial.ttf")

ORANGE = (1.0, 0.055, 0.006, 1.0)
WARM = (0.83, 0.80, 0.74, 1.0)
WARM_BRIGHT = (0.965, 0.945, 0.90, 1.0)
INK = (0.003, 0.004, 0.005, 1.0)
GRAPHITE = (0.025, 0.030, 0.034, 1.0)
STEEL = (0.20, 0.22, 0.23, 1.0)


def reset_scene() -> bpy.types.Scene:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        # Orphans from the default scene are safe to remove here.
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)

    scene = bpy.context.scene
    scene.name = "eGain Deployment Corridor"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.frame_start = 1
    scene.frame_end = 240
    return scene


def principled_input(bsdf: bpy.types.Node, *names: str):
    for name in names:
        socket = bsdf.inputs.get(name)
        if socket is not None:
            return socket
    return None


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.4,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    transmission: float = 0.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        return mat

    socket = principled_input(bsdf, "Base Color")
    if socket:
        socket.default_value = color
    socket = principled_input(bsdf, "Metallic")
    if socket:
        socket.default_value = metallic
    socket = principled_input(bsdf, "Roughness")
    if socket:
        socket.default_value = roughness
    socket = principled_input(bsdf, "Alpha")
    if socket:
        socket.default_value = alpha
    socket = principled_input(bsdf, "Transmission Weight", "Transmission")
    if socket:
        socket.default_value = transmission

    if emission is not None:
        socket = principled_input(bsdf, "Emission Color", "Emission")
        if socket:
            socket.default_value = emission
        socket = principled_input(bsdf, "Emission Strength")
        if socket:
            socket.default_value = emission_strength

    if alpha < 1.0 or transmission > 0.0:
        try:
            mat.surface_render_method = "DITHERED"
        except (AttributeError, TypeError):
            pass
        mat.use_transparency_overlap = False
    return mat


def set_parent_keep_world(obj: bpy.types.Object, parent: bpy.types.Object | None) -> None:
    if parent is None:
        return
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def add_group(name: str, center_y: float, chapter: str) -> bpy.types.Object:
    empty = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(empty)
    empty.empty_display_type = "CUBE"
    empty.empty_display_size = 0.65
    empty.location = (0.0, center_y, 0.0)
    empty["chapter"] = chapter
    empty["webForwardZ"] = -center_y
    empty["animationOwner"] = "GSAP"
    return empty


def add_box(
    name: str,
    dims: tuple[float, float, float],
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    bevel: float = 0.08,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0.0:
        modifier = obj.modifiers.new(name="Precision bevel", type="BEVEL")
        modifier.width = min(bevel, min(dims) * 0.3)
        modifier.segments = 2 if bevel >= 0.045 and min(dims) >= 0.11 else 1
        modifier.limit_method = "ANGLE"
        try:
            modifier.harden_normals = True
        except AttributeError:
            pass
    # Weighted normals keep broad machined surfaces optically flat while the
    # two-step bevel catches a crisp highlight. The modifier is baked before
    # batching, so the web runtime pays no per-frame modifier cost.
    if bevel >= 0.075 and min(dims) >= 0.18 and max(dims) >= 1.0:
        try:
            weighted = obj.modifiers.new(name="Weighted hard-surface normals", type="WEIGHTED_NORMAL")
            weighted.keep_sharp = True
            weighted.weight = 45
        except (RuntimeError, TypeError, AttributeError):
            pass
    obj.data.materials.append(mat)
    set_parent_keep_world(obj, parent)
    return obj


def add_cylinder(
    name: str,
    radius: float,
    depth: float,
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    vertices: int = 24,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=loc,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new(name="Edge bevel", type="BEVEL")
    bevel.width = min(radius * 0.12, 0.06)
    bevel.segments = 2 if radius >= 0.16 else 1
    try:
        bevel.harden_normals = True
        if radius >= 0.22 and depth >= 0.15:
            weighted = obj.modifiers.new(name="Weighted radial normals", type="WEIGHTED_NORMAL")
            weighted.keep_sharp = True
            weighted.weight = 35
    except (RuntimeError, TypeError, AttributeError):
        pass
    set_parent_keep_world(obj, parent)
    return obj


def add_uv_sphere(
    name: str,
    radius: float,
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    segments: int = 24,
    rings: int = 12,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=radius,
        location=loc,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    set_parent_keep_world(obj, parent)
    return obj


def add_torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=48,
        minor_segments=8,
        location=loc,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    set_parent_keep_world(obj, parent)
    return obj


def add_curve(
    name: str,
    points: list[tuple[float, float, float]],
    mat: bpy.types.Material,
    *,
    radius: float = 0.05,
    parent: bpy.types.Object | None = None,
    convert: bool = True,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(name=f"{name}Curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 2
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 2
    curve_data.resolution_u = 2
    spline = curve_data.splines.new("NURBS")
    spline.points.add(len(points) - 1)
    for point, xyz in zip(spline.points, points):
        point.co = (*xyz, 1.0)
    spline.order_u = min(3, len(points))
    spline.use_endpoint_u = True
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.scene.collection.objects.link(obj)
    curve_data.materials.append(mat)
    if convert:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        obj = bpy.context.object
        obj.name = name
    set_parent_keep_world(obj, parent)
    return obj


def add_text(
    name: str,
    body: str,
    loc: tuple[float, float, float],
    size: float,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    align: str = "CENTER",
    font_path: Path = FONT_BOLD,
    rotation: tuple[float, float, float] = (math.radians(90.0), 0.0, 0.0),
    extrude: float = 0.018,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name=f"{name}Curve", type="FONT")
    curve.body = body
    curve.align_x = align
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = extrude
    curve.bevel_depth = 0.004
    if font_path.exists():
        curve.font = bpy.data.fonts.load(str(font_path), check_existing=True)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rotation
    curve.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    set_parent_keep_world(obj, parent)
    return obj


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area_light(
    name: str,
    loc: tuple[float, float, float],
    target: tuple[float, float, float],
    color: tuple[float, float, float],
    energy: float,
    size: float,
) -> bpy.types.Object:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    # One key shadow is enough for the poster. Additional shadow maps only
    # multiply Eevee atlas pressure across hundreds of small corridor parts.
    data.use_shadow = name == "WarmWorldKey"
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    look_at(obj, target)
    return obj


def add_point_light(
    name: str,
    loc: tuple[float, float, float],
    color: tuple[float, float, float],
    energy: float,
    radius: float = 1.0,
) -> bpy.types.Object:
    data = bpy.data.lights.new(name=name, type="POINT")
    data.energy = energy
    data.color = color
    data.shadow_soft_size = radius
    data.use_shadow = False
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    return obj


def add_front_frame(
    prefix: str,
    center: tuple[float, float, float],
    dims: tuple[float, float, float],
    mat: bpy.types.Material,
    parent: bpy.types.Object,
    thickness: float = 0.055,
) -> None:
    x, y, z = center
    w, d, h = dims
    front_y = y - d * 0.51
    for suffix, width, height, px, pz in (
        ("Top", w, thickness, x, z + h * 0.5),
        ("Bottom", w, thickness, x, z - h * 0.5),
        ("Left", thickness, h, x - w * 0.5, z),
        ("Right", thickness, h, x + w * 0.5, z),
    ):
        add_box(
            f"{prefix}_{suffix}",
            (width, thickness, height),
            (px, front_y, pz),
            mat,
            parent=parent,
            bevel=thickness * 0.35,
        )


def add_fastener(
    name: str,
    loc: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    radius: float = 0.105,
    depth: float = 0.11,
    slot_mat: bpy.types.Material | None = None,
) -> bpy.types.Object:
    """Add a low-poly, camera-facing mechanical fastener with a real slot."""
    head = add_cylinder(
        name,
        radius,
        depth,
        loc,
        mat,
        parent=parent,
        rotation=(math.radians(90.0), 0.0, 0.0),
        vertices=12,
    )
    add_box(
        f"{name}_Slot",
        (radius * 1.15, 0.026, radius * 0.18),
        (loc[0], loc[1] - depth * 0.56, loc[2]),
        slot_mat or mat,
        parent=parent,
        bevel=0.008,
    )
    return head


def add_panel_frame(
    prefix: str,
    center: tuple[float, float, float],
    size: tuple[float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    depth: float = 0.075,
    rail: float = 0.075,
) -> None:
    """Layer a chamfered service-panel perimeter onto a front-facing surface."""
    x, y, z = center
    width, height = size
    add_box(f"{prefix}_Top", (width, depth, rail), (x, y, z + height * 0.5), mat, parent=parent, bevel=rail * 0.28)
    add_box(f"{prefix}_Bottom", (width, depth, rail), (x, y, z - height * 0.5), mat, parent=parent, bevel=rail * 0.28)
    add_box(f"{prefix}_Left", (rail, depth, height), (x - width * 0.5, y, z), mat, parent=parent, bevel=rail * 0.28)
    add_box(f"{prefix}_Right", (rail, depth, height), (x + width * 0.5, y, z), mat, parent=parent, bevel=rail * 0.28)


def add_vent_bank(
    prefix: str,
    center: tuple[float, float, float],
    count: int,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    span: float,
    height: float,
    depth: float = 0.07,
) -> None:
    """Build raised heat-sink fins; joined later into one web mesh."""
    x, y, z = center
    step = span / max(count - 1, 1)
    for index in range(count):
        add_box(
            f"{prefix}_{index:02d}",
            (0.055, depth, height),
            (x - span * 0.5 + index * step, y, z),
            mat,
            parent=parent,
            bevel=0.014,
        )


def add_indicator_strip(
    prefix: str,
    start: tuple[float, float, float],
    count: int,
    step: float,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    radius: float = 0.045,
) -> None:
    """Add a row of small emissive status lenses."""
    for index in range(count):
        add_uv_sphere(
            f"{prefix}_{index:02d}",
            radius if index % 3 else radius * 1.22,
            (start[0] + index * step, start[1], start[2]),
            mat,
            parent=parent,
            segments=10,
            rings=5,
        )


def build_environment(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    root = add_group("CorridorEnvironment", 30.0, "environment")
    root.empty_display_type = "PLAIN_AXES"

    # Two worlds share one rail bed: engineered warm white on the left, dense
    # cyber black on the right. The front edge remains low for the hero camera.
    add_box("WarmFloor", (11.8, 68.0, 0.45), (-5.9, 29.0, -0.30), mats["warm"], parent=root, bevel=0.04)
    add_box("DarkFloor", (11.8, 68.0, 0.45), (5.9, 29.0, -0.30), mats["ink"], parent=root, bevel=0.04)
    add_box("WarmSideWall", (0.35, 68.0, 14.0), (-11.5, 30.0, 6.7), mats["warm_bright"], parent=root, bevel=0.10)
    add_box("DarkSideWall", (0.35, 68.0, 14.0), (11.5, 30.0, 6.7), mats["ink"], parent=root, bevel=0.10)
    add_box("WarmCeilingBlade", (11.0, 54.0, 0.24), (-6.0, 23.0, 13.4), mats["warm_bright"], parent=root, bevel=0.06)
    add_box("DarkCeilingBlade", (11.0, 54.0, 0.24), (6.0, 23.0, 13.4), mats["ink"], parent=root, bevel=0.06)

    for index, y in enumerate(range(0, 64, 5)):
        warm_mat = mats["warm"] if index % 2 == 0 else mats["steel"]
        add_box(f"WarmRib_{index:02d}", (0.22, 0.30, 10.0), (-9.6, float(y), 5.0), warm_mat, parent=root, bevel=0.045)
        add_box(f"DarkRib_{index:02d}", (0.22, 0.30, 10.0), (9.6, float(y), 5.0), mats["graphite"], parent=root, bevel=0.045)
        add_box(f"CeilingCrossbar_{index:02d}", (19.4, 0.20, 0.20), (0.0, float(y), 11.8), mats["steel"], parent=root, bevel=0.035)

    # Small suspended architecture fragments add scale without expensive hero meshes.
    for index in range(28):
        side = -1.0 if index % 2 == 0 else 1.0
        x = side * (7.4 + (index % 3) * 0.55)
        y = 2.0 + index * 2.05
        z = 2.0 + (index * 1.37) % 7.0
        mat = mats["warm"] if side < 0 else mats["graphite"]
        add_box(f"SuspendedBlock_{index:02d}", (0.55, 0.55, 0.55), (x, y, z), mat, parent=root, bevel=0.07)

    # Recessed floor cassettes and illuminated ceiling registration marks make
    # the corridor read as a manufactured environment at close range.
    for index, y in enumerate(range(-2, 64, 4)):
        add_box(
            f"WarmFloorCassette_{index:02d}",
            (4.25, 3.55, 0.055),
            (-7.1, float(y), -0.045),
            mats["warm_bright"] if index % 2 == 0 else mats["warm"],
            parent=root,
            bevel=0.035,
        )
        add_box(
            f"DarkFloorCassette_{index:02d}",
            (4.25, 3.55, 0.055),
            (7.1, float(y), -0.045),
            mats["graphite"],
            parent=root,
            bevel=0.035,
        )
        add_box(
            f"CeilingSignalMark_{index:02d}",
            (0.08, 1.55, 0.065),
            ((-1.8 if index % 2 == 0 else 1.8), float(y), 13.20),
            mats["orange_dim"],
            parent=root,
            bevel=0.018,
        )

    return root


def build_signal_rail(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    group = add_group("SignalRail", 28.0, "signal")
    group["role"] = "persistent energy spine"

    for index, x in enumerate((-6.2, -3.1, 0.0, 3.1, 6.2)):
        add_box(f"Rail_{index}", (0.22, 66.0, 0.20), (x, 29.0, 0.18), mats["steel"], parent=group, bevel=0.055)
        add_box(f"RailInset_{index}", (0.055, 65.0, 0.07), (x, 29.0, 0.325), mats["orange"], parent=group, bevel=0.02)

    for index, y in enumerate(range(-2, 64, 3)):
        add_box(f"RailTie_{index:02d}", (15.0, 0.18, 0.15), (0.0, float(y), 0.08), mats["graphite"], parent=group, bevel=0.035)
        for x in (-6.2, -3.1, 0.0, 3.1, 6.2):
            add_box(f"RailClamp_{index:02d}_{x:+.1f}", (0.48, 0.42, 0.26), (x, float(y), 0.27), mats["chrome"], parent=group, bevel=0.07)

    for stream in range(4):
        points = []
        for step in range(45):
            y = -4.0 + step * 1.52
            phase = stream * 1.7
            x = -1.45 + stream * 0.78 + math.sin(y * 0.17 + phase) * (0.24 + stream * 0.035)
            z = 0.52 + stream * 0.085 + math.sin(y * 0.31 + phase) * 0.045
            points.append((x, y, z))
        add_curve(f"EnergyStream_{stream}", points, mats["orange"], radius=0.035 + stream * 0.008, parent=group)

    for index, y in enumerate(range(0, 62, 4)):
        x = -0.45 + math.sin(y * 0.17) * 0.25
        add_box(f"DataPacket_{index:02d}", (0.32, 0.72, 0.25), (x, float(y), 0.68), mats["orange"], parent=group, bevel=0.06)

    return group


def build_assembly(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    group = add_group("BuildAssembly", 6.0, "build")
    group["headline"] = "ENGINEERING IDEAS INTO SYSTEMS."

    add_box("BuildMainBody", (5.6, 4.8, 5.2), (-4.8, 6.5, 2.65), mats["warm_bright"], parent=group, bevel=0.20)
    add_box("BuildLowerSkid", (6.15, 5.20, 0.34), (-4.8, 6.65, 0.18), mats["chrome"], parent=group, bevel=0.10)
    add_box("BuildUpperSpine", (5.10, 4.15, 0.28), (-4.8, 6.55, 5.36), mats["steel"], parent=group, bevel=0.08)
    add_box("BuildLeftCheek", (0.25, 4.36, 4.55), (-7.72, 6.55, 2.62), mats["steel"], parent=group, bevel=0.08)
    add_box("BuildRightCheek", (0.25, 4.36, 4.55), (-1.88, 6.55, 2.62), mats["graphite"], parent=group, bevel=0.08)
    add_box("BuildFace", (4.9, 0.16, 1.55), (-4.8, 4.02, 3.15), mats["ink"], parent=group, bevel=0.06)
    add_text("BuildTitle", "BUILD", (-4.8, 3.90, 3.15), 1.20, mats["warm_bright"], parent=group)
    add_box("BuildCoreSlot", (3.5, 0.18, 0.62), (-4.8, 4.00, 1.42), mats["orange"], parent=group, bevel=0.06)
    add_panel_frame("BuildFacePerimeter", (-4.8, 3.91, 3.15), (5.10, 1.76), mats["chrome"], parent=group, depth=0.10, rail=0.09)
    add_panel_frame("BuildCorePerimeter", (-4.8, 3.90, 1.42), (3.95, 0.94), mats["steel"], parent=group, depth=0.09, rail=0.07)

    # Real service seams, fasteners, heat management and I/O turn the monolith
    # into a plausible build machine without cluttering the BUILD wordmark.
    for index, x in enumerate((-7.15, -6.00, -3.60, -2.45)):
        add_box(f"BuildPanelSeamV_{index}", (0.035, 0.055, 0.72), (x, 3.895, 0.64), mats["graphite"], parent=group, bevel=0.010)
    for index, (x, z) in enumerate(((-7.18, 4.72), (-2.42, 4.72), (-7.18, 1.97), (-2.42, 1.97), (-6.55, 0.58), (-3.05, 0.58))):
        add_fastener(f"BuildFaceBolt_{index}", (x, 3.82, z), mats["chrome"], parent=group, radius=0.105, depth=0.12, slot_mat=mats["ink"])
    add_vent_bank("BuildHeatSink", (-6.13, 3.82, 4.55), 9, mats["steel"], parent=group, span=1.52, height=0.58, depth=0.15)
    add_indicator_strip("BuildStatusLens", (-3.85, 3.78, 4.56), 7, 0.22, mats["orange"], parent=group, radius=0.045)

    # A pair of recessed circular service ports and an industrial connector bay.
    for index, (x, radius) in enumerate(((-6.70, 0.30), (-5.88, 0.23))):
        add_cylinder(f"BuildServicePort_{index}", radius, 0.15, (x, 3.82, 0.80), mats["graphite"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0), vertices=20)
        add_torus(f"BuildServicePortRing_{index}", radius * 1.02, 0.045, (x, 3.72, 0.80), mats["orange_dim"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0))
    add_box("BuildConnectorBay", (1.50, 0.14, 0.75), (-3.38, 3.83, 0.78), mats["graphite"], parent=group, bevel=0.07)
    for index in range(4):
        add_box(f"BuildConnector_{index}", (0.22, 0.11, 0.29), (-3.88 + index * 0.34, 3.73, 0.78), mats["steel"], parent=group, bevel=0.025)

    for row in range(3):
        for col in range(4):
            x = -7.35 + col * 1.70
            y = 8.75 + row * 0.82
            z = 0.65 + row * 1.15 + (col % 2) * 0.32
            dims = (1.15, 1.10, 0.82 + row * 0.18)
            mat = mats["warm"] if (row + col) % 2 else mats["steel"]
            add_box(f"BuildModule_{row}_{col}", dims, (x, y, z), mat, parent=group, bevel=0.13)
            # Each module receives a seam plate and an orange registration pin.
            add_box(
                f"BuildModuleInset_{row}_{col}",
                (dims[0] * 0.68, 0.075, dims[2] * 0.54),
                (x, y - dims[1] * 0.52, z),
                mats["graphite"],
                parent=group,
                bevel=0.045,
            )
            add_cylinder(
                f"BuildModulePin_{row}_{col}",
                0.065,
                0.10,
                (x + dims[0] * 0.28, y - dims[1] * 0.57, z + dims[2] * 0.28),
                mats["orange"],
                parent=group,
                rotation=(math.radians(90.0), 0.0, 0.0),
                vertices=10,
            )

    # Floating source-code voxels create the sense of software becoming physical.
    for index in range(20):
        x = -9.1 + (index % 5) * 1.35
        y = 0.2 + (index // 5) * 1.25
        z = 0.7 + ((index * 7) % 9) * 0.52
        scale = 0.35 + (index % 3) * 0.13
        mat = mats["ink"] if index % 3 == 0 else mats["steel"]
        add_box(f"SourceVoxel_{index:02d}", (scale, scale, scale), (x, y, z), mat, parent=group, bevel=0.075)

    add_box("CodeSlate", (3.8, 0.22, 3.0), (-7.8, 2.1, 2.2), mats["ink"], parent=group, bevel=0.14)
    for index, width in enumerate((2.4, 1.8, 2.65, 1.25, 2.1)):
        add_box(f"CodeLine_{index}", (width, 0.08, 0.045), (-8.15 + width * 0.10, 1.95, 3.15 - index * 0.42), mats["orange"], parent=group, bevel=0.018)
    add_text("CodeSlateLabel", "API / CORE", (-7.8, 1.84, 1.15), 0.32, mats["warm_bright"], parent=group, font_path=FONT_REGULAR)

    # Structural outriggers suggest that the system is assembled around the rail.
    for side in (-1.0, 1.0):
        x = -4.8 + side * 3.30
        add_box(f"BuildOutrigger_{'L' if side < 0 else 'R'}", (0.32, 3.4, 0.32), (x, 6.6, 0.52), mats["chrome"], parent=group, bevel=0.07, rotation=(0.0, math.radians(side * 11.0), 0.0))
        add_cylinder(f"BuildOutriggerJoint_{'L' if side < 0 else 'R'}", 0.32, 0.36, (x, 4.95, 0.54), mats["graphite"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0), vertices=16)
    return group


def build_test_gate(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    group = add_group("TestGate", 17.0, "test")
    group["headline"] = "PROOF BEFORE PROMISE."

    for side in (-1.0, 1.0):
        suffix = "L" if side < 0 else "R"
        add_box(f"TestPillar_{suffix}", (0.66, 0.92, 8.1), (side * 3.05, 17.0, 4.1), mats["chrome"], parent=group, bevel=0.13)
        add_box(f"TestPillarGlow_{suffix}", (0.09, 0.98, 7.1), (side * 3.05, 16.48, 4.1), mats["orange"], parent=group, bevel=0.025)
        add_box(f"TestInnerRail_{suffix}", (0.15, 0.20, 6.95), (side * 2.68, 16.39, 4.05), mats["steel"], parent=group, bevel=0.040)
        add_box(f"TestCableRaceway_{suffix}", (0.22, 0.18, 5.85), (side * 3.48, 16.47, 4.12), mats["graphite"], parent=group, bevel=0.050)
        add_box(f"TestFootPlate_{suffix}", (1.25, 1.45, 0.23), (side * 3.05, 17.05, 0.15), mats["steel"], parent=group, bevel=0.07)
        add_vent_bank(
            f"TestPillarVent_{suffix}",
            (side * 3.05, 16.47, 6.45),
            6,
            mats["ink"],
            parent=group,
            span=0.38,
            height=0.62,
            depth=0.075,
        )
        for bolt_index, z in enumerate((0.63, 2.25, 5.85, 7.52)):
            add_fastener(
                f"TestPillarBolt_{suffix}_{bolt_index}",
                (side * 3.05, 16.42, z),
                mats["chrome"],
                parent=group,
                radius=0.09,
                depth=0.10,
                slot_mat=mats["ink"],
            )
    add_box("TestHeader", (6.7, 0.82, 0.62), (0.0, 17.0, 8.0), mats["chrome"], parent=group, bevel=0.13)
    add_box("TestHeaderCap", (5.95, 0.98, 0.26), (0.0, 17.0, 8.48), mats["graphite"], parent=group, bevel=0.075)
    add_box("TestHeaderChannel", (4.75, 0.18, 0.18), (0.0, 16.48, 7.94), mats["orange_dim"], parent=group, bevel=0.035)
    for motor_x in (-1.65, 1.65):
        add_cylinder("TestHeaderMotor" + ("L" if motor_x < 0 else "R"), 0.30, 0.52, (motor_x, 16.55, 8.32), mats["graphite"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0), vertices=20)
        add_cylinder("TestHeaderMotorHub" + ("L" if motor_x < 0 else "R"), 0.13, 0.58, (motor_x, 16.50, 8.32), mats["orange"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0), vertices=16)
    add_box("TestThreshold", (6.7, 1.35, 0.36), (0.0, 17.0, 0.25), mats["graphite"], parent=group, bevel=0.08)
    add_box("TestThresholdInset", (5.55, 1.52, 0.10), (0.0, 17.0, 0.46), mats["steel"], parent=group, bevel=0.035)
    for strip in range(5):
        add_box(f"TestThresholdGuide_{strip}", (0.075, 1.68, 0.045), (-2.0 + strip * 1.0, 17.0, 0.53), mats["orange_dim"], parent=group, bevel=0.014)
    add_box("TestGlass", (5.85, 0.12, 6.95), (0.0, 16.94, 4.05), mats["glass"], parent=group, bevel=0.05)
    scanner = add_box("TestScanner", (5.55, 0.22, 0.18), (0.0, 16.64, 4.45), mats["graphite"], parent=group, bevel=0.055)
    add_box("TestScannerBlade", (5.24, 0.16, 0.055), (0.0, 16.48, 4.45), mats["orange"], parent=scanner, bevel=0.018)
    add_box("TestScannerLowerBlade", (4.74, 0.13, 0.045), (0.0, 16.47, 4.27), mats["orange_dim"], parent=scanner, bevel=0.014)
    for side in (-1.0, 1.0):
        suffix = "L" if side < 0 else "R"
        add_box(f"TestScannerCarriage_{suffix}", (0.52, 0.46, 0.62), (side * 2.65, 16.66, 4.45), mats["chrome"], parent=scanner, bevel=0.09)
        add_cylinder(f"TestScannerRoller_{suffix}", 0.15, 0.22, (side * 2.65, 16.38, 4.45), mats["steel"], parent=scanner, rotation=(math.radians(90.0), 0.0, 0.0), vertices=16)
    for index, x in enumerate((-1.85, -0.92, 0.0, 0.92, 1.85)):
        add_cylinder(f"TestScannerSensor_{index}", 0.105, 0.20, (x, 16.38, 4.49), mats["orange"], parent=scanner, rotation=(math.radians(90.0), 0.0, 0.0), vertices=14)
        add_torus(f"TestScannerSensorRing_{index}", 0.12, 0.022, (x, 16.27, 4.49), mats["chrome"], parent=scanner, rotation=(math.radians(90.0), 0.0, 0.0))
    add_text("TestTitle", "TEST", (0.0, 16.55, 6.65), 1.26, mats["ink"], parent=group)

    # Fine calibration ticks establish measurement scale behind the moving scan head.
    for index in range(11):
        x = -2.25 + index * 0.45
        tick_height = 0.20 if index % 5 else 0.34
        add_box(f"TestCalibrationTick_{index:02d}", (0.025, 0.035, tick_height), (x, 16.39, 5.55), mats["orange_dim"], parent=group, bevel=0.006)

    checklist = ("UNIT TESTS", "INTEGRATION", "SECURITY", "QUALITY GATE")
    for index, label in enumerate(checklist):
        z = 4.75 - index * 0.82
        add_box(f"CheckBox_{index}", (0.30, 0.055, 0.30), (-1.88, 16.50, z), mats["orange"], parent=group, bevel=0.035)
        add_text(f"CheckLabel_{index}", label, (-1.43, 16.46, z), 0.29, mats["ink"], parent=group, align="LEFT", font_path=FONT_REGULAR, extrude=0.010)

    for index, (x, z) in enumerate(((-2.67, 0.75), (2.67, 0.75), (-2.67, 7.35), (2.67, 7.35))):
        add_fastener(f"GateBolt_{index}", (x, 16.40, z), mats["ink"], parent=group, radius=0.17, depth=0.19, slot_mat=mats["steel"])
    return group


def build_deploy_array(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    group = add_group("DeployArray", 28.5, "deploy")
    group["headline"] = "FROM COMMIT TO CLOUD."

    # The first-version camera bends from x ~= 0.8 to x ~= 2.6 while it is
    # inside Deploy.  Keep the structural aisle centred at x=1.625 instead of
    # centring it on the world origin: the rack faces then leave a real 4.30m
    # gap (-0.525 .. 3.775), with enough room for the 0.42m camera sweep body.
    module_centers = (-5.75, -2.20, 5.45)
    group["centralAisleCenterX"] = 1.625
    group["centralAisleWidth"] = 4.30
    for col, x in enumerate(module_centers):
        for row in range(2):
            z = 1.45 + row * 2.65
            cell_id = col * 2 + row + 1
            mat = mats["warm"] if col == 0 else mats["graphite"]
            add_box(f"DeployCell_{col}_{row}", (3.35, 4.5, 2.25), (x, 28.5, z), mat, parent=group, bevel=0.18)
            add_front_frame(f"DeployFrame_{col}_{row}", (x, 28.5, z), (3.0, 4.5, 1.90), mats["orange"], group, thickness=0.045)
            add_box(f"DeployRackFace_{col}_{row}", (2.66, 0.16, 1.66), (x, 26.17, z), mats["ink"], parent=group, bevel=0.065)
            add_panel_frame(f"DeployRackBezel_{col}_{row}", (x, 26.06, z), (2.82, 1.82), mats["steel"], parent=group, depth=0.08, rail=0.055)
            # Six rack-unit blades with real grab rails and alternating status lights.
            for unit in range(6):
                unit_z = z + 0.62 - unit * 0.245
                add_box(
                    f"DeployRackUnit_{col}_{row}_{unit}",
                    (2.28, 0.095, 0.175),
                    (x - 0.08, 25.99, unit_z),
                    mats["graphite"] if unit % 2 == 0 else mats["steel"],
                    parent=group,
                    bevel=0.028,
                )
                add_box(
                    f"DeployRackHandle_{col}_{row}_{unit}",
                    (0.32, 0.055, 0.055),
                    (x - 0.78, 25.92, unit_z),
                    mats["chrome"],
                    parent=group,
                    bevel=0.014,
                )
                add_uv_sphere(
                    f"DeployRackLED_{col}_{row}_{unit}",
                    0.034,
                    (x + 0.86, 25.91, unit_z),
                    mats["orange"] if (unit + cell_id) % 3 else mats["orange_dim"],
                    parent=group,
                    segments=8,
                    rings=4,
                )
            add_box(f"DeployPullHandle_{col}_{row}", (0.11, 0.19, 1.12), (x + 1.12, 25.91, z), mats["chrome"], parent=group, bevel=0.035)
            for fastener_index, (dx, dz) in enumerate(((-1.22, -0.70), (1.22, -0.70), (-1.22, 0.70), (1.22, 0.70))):
                add_fastener(
                    f"DeployBolt_{col}_{row}_{fastener_index}",
                    (x + dx, 25.92, z + dz),
                    mats["chrome"],
                    parent=group,
                    radius=0.067,
                    depth=0.085,
                    slot_mat=mats["ink"],
                )
            for vent in range(6):
                add_box(
                    f"DeployVent_{col}_{row}_{vent}",
                    (0.055, 0.08, 1.28),
                    (x - 0.58 + vent * 0.24, 26.00, z),
                    mats["steel"],
                    parent=group,
                    bevel=0.014,
                )

            # Rear service spine and top interlock are visible during the fly-through.
            add_box(f"DeployRearSpine_{col}_{row}", (0.28, 4.72, 1.72), (x - 1.47, 28.58, z), mats["chrome"], parent=group, bevel=0.07)
            add_box(f"DeployInterlock_{col}_{row}", (1.35, 0.72, 0.18), (x, 26.42, z + 1.18), mats["orange_dim"], parent=group, bevel=0.05)

    add_box("DeployCrown", (11.6, 3.0, 1.38), (1.15, 28.2, 6.40), mats["warm_bright"], parent=group, bevel=0.20)
    add_box("DeployCrownFace", (10.7, 0.14, 0.92), (1.15, 26.64, 6.40), mats["ink"], parent=group, bevel=0.05)
    add_panel_frame("DeployCrownPerimeter", (1.15, 26.54, 6.40), (10.90, 1.08), mats["chrome"], parent=group, depth=0.09, rail=0.065)
    add_indicator_strip("DeployCrownStatus", (-3.55, 26.46, 6.40), 12, 0.62, mats["orange"], parent=group, radius=0.042)
    for index, x in enumerate((-3.85, -1.35, 1.15, 3.65, 6.15)):
        add_box(f"DeployCrownSeam_{index}", (0.035, 0.05, 0.72), (x, 26.46, 6.40), mats["steel"], parent=group, bevel=0.009)
    # A dedicated right-side hero sign clears the transparent Test gate's
    # perspective silhouette, keeping all three chapter words readable at once.
    hero_sign = (6.75, 24.85, 6.25)
    add_box("DeployHeroSign", (4.1, 0.22, 1.48), hero_sign, mats["ink"], parent=group, bevel=0.10)
    add_front_frame("DeployHeroSignFrame", hero_sign, (3.82, 0.22, 1.22), mats["orange"], group, thickness=0.045)
    add_text("DeployTitle", "DEPLOY", (6.75, 24.65, 6.25), 0.72, mats["warm_bright"], parent=group)

    for index, y in enumerate((24.8, 26.0, 31.0, 32.2)):
        add_box(f"DeployBus_{index}", (12.0, 0.13, 0.13), (1.2, y, 0.62 + (index % 2) * 0.25), mats["orange"], parent=group, bevel=0.035)
        for socket_index, x in enumerate(module_centers):
            add_cylinder(
                f"DeployBusSocket_{index}_{socket_index}",
                0.13,
                0.18,
                (x, y - 0.10, 0.62 + (index % 2) * 0.25),
                mats["chrome"],
                parent=group,
                rotation=(math.radians(90.0), 0.0, 0.0),
                vertices=14,
            )

    # Braided logical uplinks arc from every rack toward the crown bus.
    for index, x in enumerate(module_centers):
        add_curve(
            f"DeployUplink_{index}",
            [
                (x + 0.9, 26.1, 4.6),
                (x + 1.0, 26.4, 5.25),
                (x * 0.55 + 0.5, 27.0, 5.75),
                (1.15, 27.2, 6.05),
            ],
            mats["orange_dim"],
            radius=0.055,
            parent=group,
        )
    return group


def build_protect_plane(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    group = add_group("ProtectPlane", 39.0, "protect")
    group["headline"] = "SECURITY BECOMES THE ENVIRONMENT."
    group["signatureMoment"] = True

    lean = math.radians(-10.0)
    shield_y = 39.4
    shield_depth = 8.8

    # The divider is intentionally short along the travel axis. It delivers a
    # hard wipe at the chapter threshold, then releases the lens into the black
    # topology world instead of trapping the camera inside a 34m slab.
    add_box("ProtectDivider", (0.46, shield_depth, 15.5), (3.32, shield_y, 7.15), mats["ink"], parent=group, bevel=0.11, rotation=(0.0, lean, 0.0))
    add_box("ProtectDividerBacking", (0.24, shield_depth - 0.35, 14.7), (3.67, shield_y + 0.05, 7.15), mats["graphite"], parent=group, bevel=0.075, rotation=(0.0, lean, 0.0))
    add_box("ProtectDividerLaminate", (0.14, shield_depth + 0.20, 14.95), (2.72, shield_y - 0.05, 7.15), mats["chrome"], parent=group, bevel=0.045, rotation=(0.0, lean, 0.0))
    add_box("ProtectEdge", (0.095, shield_depth + 0.55, 15.1), (2.10, shield_y - 0.10, 7.15), mats["orange"], parent=group, bevel=0.028, rotation=(0.0, lean, 0.0))
    add_box("ProtectFoot", (0.82, shield_depth + 0.35, 0.35), (3.35, shield_y - 0.05, 0.15), mats["chrome"], parent=group, bevel=0.08)

    # Layered vertical armour cassettes, structural ribs and inspection bolts.
    for index in range(6):
        y = shield_y - shield_depth * 0.42 + index * (shield_depth * 0.84 / 5)
        add_box(f"ProtectArmourCassette_{index}", (0.31, 1.18, 12.1), (3.00 + (index % 2) * 0.13, y, 6.55), mats["graphite"] if index % 2 else mats["ink"], parent=group, bevel=0.07, rotation=(0.0, lean, 0.0))
        add_box(f"ProtectSpine_{index}", (0.22, 0.19, 13.15), (2.52, y, 6.75), mats["steel"], parent=group, bevel=0.045, rotation=(0.0, lean, 0.0))
        for z in (1.35, 4.45, 7.55, 10.65):
            add_cylinder(
                f"ProtectRivet_{index}_{int(z * 10)}",
                0.085,
                0.28,
                (2.32, y - 0.02, z),
                mats["chrome"],
                parent=group,
                rotation=(0.0, math.radians(90.0), 0.0),
                vertices=12,
            )

    # A compact shield gate at the chapter face: three nested frames, a real
    # mechanical lock and diagonal load paths make Protect the signature moment.
    gate_y = shield_y - shield_depth * 0.50 - 0.22
    for layer, inset in enumerate((0.0, 0.42, 0.82)):
        frame_mat = mats["graphite"] if layer == 0 else mats["steel"]
        add_box(f"ProtectGateTop_{layer}", (8.4 - inset, 0.34 - layer * 0.05, 0.38), (6.15 + inset * 0.22, gate_y - layer * 0.06, 10.10 - inset * 0.28), frame_mat, parent=group, bevel=0.09)
        add_box(f"ProtectGateRight_{layer}", (0.38, 0.34 - layer * 0.05, 9.35 - inset), (10.14 - inset * 0.22, gate_y - layer * 0.06, 5.25), frame_mat, parent=group, bevel=0.09)
        add_box(f"ProtectGateSide_{layer}", (0.38, 0.34 - layer * 0.05, 9.35 - inset), (2.18 + inset * 0.18, gate_y - layer * 0.06, 5.25), mats["orange"] if layer == 2 else frame_mat, parent=group, bevel=0.08, rotation=(0.0, lean, 0.0))

    # Segmented armour plates leave controlled gaps through which the topology
    # can be glimpsed during the wipe.
    for row in range(3):
        for col in range(2):
            x = 4.45 + col * 3.15
            z = 2.15 + row * 2.45
            add_box(f"ProtectShieldTile_{row}_{col}", (2.62, 0.18, 1.92), (x, gate_y - 0.22, z), mats["ink"] if (row + col) % 2 else mats["graphite"], parent=group, bevel=0.105, rotation=(0.0, 0.0, math.radians((-1 if col == 0 else 1) * 1.5)))
            add_panel_frame(f"ProtectTileFrame_{row}_{col}", (x, gate_y - 0.34, z), (2.36, 1.66), mats["steel"], parent=group, depth=0.07, rail=0.045)
            for dx in (-1.03, 1.03):
                for dz in (-0.66, 0.66):
                    add_fastener(f"ProtectTileBolt_{row}_{col}_{dx:+.0f}_{dz:+.0f}", (x + dx, gate_y - 0.40, z + dz), mats["chrome"], parent=group, radius=0.062, depth=0.075, slot_mat=mats["ink"])

    lock_center = (6.15, gate_y - 0.55, 5.40)
    add_cylinder("ProtectLockBody", 0.92, 0.38, lock_center, mats["chrome"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0), vertices=32)
    add_torus("ProtectLockOuter", 0.96, 0.095, (lock_center[0], lock_center[1] - 0.21, lock_center[2]), mats["orange"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0))
    add_cylinder("ProtectLockCore", 0.40, 0.50, (lock_center[0], lock_center[1] - 0.08, lock_center[2]), mats["ink"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0), vertices=24)
    for arm_index in range(6):
        angle = math.tau * arm_index / 6.0
        add_box(
            f"ProtectLockArm_{arm_index}",
            (1.15, 0.16, 0.18),
            (lock_center[0] + math.cos(angle) * 1.15, lock_center[1] - 0.22, lock_center[2] + math.sin(angle) * 1.15),
            mats["steel"],
            parent=group,
            bevel=0.045,
            rotation=(0.0, 0.0, angle),
        )

    add_text("ProtectTitle", "PROTECT", (6.15, gate_y - 0.50, 8.72), 0.80, mats["warm_bright"], parent=group, rotation=(math.radians(90.0), 0.0, math.radians(5.0)))

    for index, z in enumerate((1.25, 2.35, 3.45, 6.95, 8.05, 9.15)):
        add_box(f"ProtectScan_{index}", (6.3 - abs(3 - index) * 0.34, 0.055, 0.055), (6.1, gate_y - 0.51, z), mats["orange_dim"], parent=group, bevel=0.018)
    return group


def build_cloud_topology(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    group = add_group("CloudTopology", 48.5, "operate")
    group["headline"] = "INTELLIGENCE IN MOTION."

    # Exact first-version path point at the Operate penetration beat
    # (web progress ~= .855), converted from Three.js (x, y, z) to Blender
    # (x, -z, y).  The camera now flies through the inference aperture instead
    # of passing an off-axis cloud on the empty left side.
    gimbal_center = (-0.05, 44.83, 3.17)
    group["cameraPassCenter"] = gimbal_center
    group["minimumInnerClearance"] = 3.16

    # The cloud mass becomes an overhead machine canopy.  Its lowest shell is
    # outside the camera sweep cylinder, while the gimbal remains on-axis.
    cloud_center = (-0.05, 46.45, 6.75)
    cloud_spheres = (
        (-1.35, 0.0, -0.10, 1.35),
        (-0.15, 0.0, 0.50, 1.75),
        (1.25, 0.0, 0.10, 1.45),
        (0.15, 0.0, -0.45, 1.65),
    )
    for index, (dx, dy, dz, radius) in enumerate(cloud_spheres):
        add_uv_sphere(f"CloudMass_{index}", radius, (cloud_center[0] + dx, cloud_center[1] + dy, cloud_center[2] + dz), mats["graphite"], parent=group, segments=28, rings=14)
        add_torus(f"CloudHalo_{index}", radius * 0.82, 0.045, (cloud_center[0] + dx, cloud_center[1] - radius * 0.83, cloud_center[2] + dz), mats["orange"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0))

    # The inference nucleus is a hollow energy aperture, not a solid sphere.
    # Its 1.72m major radius and 0.14m tube leave 3.16m of true inner diameter.
    # Every following link starts outside the same protected aperture.
    neural_core = add_torus(
        "NeuralInferenceCore",
        1.72,
        0.14,
        gimbal_center,
        mats["orange"],
        parent=group,
        rotation=(math.radians(90.0), 0.0, 0.0),
    )
    neural_core["innerClearance"] = 3.16
    for ring_index, radius in enumerate((2.05, 2.38, 2.72)):
        add_torus(
            f"NeuralCoreGimbal_{ring_index}",
            radius,
            0.055 + ring_index * 0.008,
            gimbal_center,
            mats["steel"] if ring_index % 2 == 0 else mats["orange_dim"],
            parent=group,
            rotation=(math.radians(90.0 - ring_index * 22.0), ring_index * 0.31, ring_index * 0.18),
        )
    for index in range(12):
        angle = math.tau * index / 12.0
        sensor_loc = (
            gimbal_center[0] + math.cos(angle) * 3.12,
            gimbal_center[1] + math.sin(angle * 2.0) * 0.28,
            gimbal_center[2] + math.sin(angle) * 3.12,
        )
        inner_loc = (
            gimbal_center[0] + math.cos(angle) * 1.76,
            gimbal_center[1],
            gimbal_center[2] + math.sin(angle) * 1.76,
        )
        add_uv_sphere(f"NeuralSensor_{index:02d}", 0.12 if index % 3 else 0.17, sensor_loc, mats["orange"], parent=group, segments=12, rings=6)
        add_curve(
            f"NeuralSensorLink_{index:02d}",
            [
                inner_loc,
                (
                    gimbal_center[0] + math.cos(angle) * 2.42,
                    gimbal_center[1] - 0.18,
                    gimbal_center[2] + math.sin(angle) * 2.42,
                ),
                sensor_loc,
            ],
            mats["orange_dim"],
            radius=0.024,
            parent=group,
        )

    gx, gy, gz = gimbal_center
    nodes = (
        ("COMPUTE", (gx - 4.20, gy - 2.00, gz + 2.60)),
        ("DATABASE", (gx + 4.40, gy - 1.20, gz + 2.00)),
        ("NETWORK", (gx - 4.60, gy + 3.80, gz - 0.10)),
        ("STORAGE", (gx + 4.70, gy + 5.80, gz + 1.00)),
        ("AI CORE", (gx - 3.60, gy + 8.00, gz + 3.00)),
    )
    for index, (label, loc) in enumerate(nodes):
        add_box(f"TopologyNode_{index}", (2.45, 2.0, 1.65), loc, mats["ink"], parent=group, bevel=0.17)
        add_box(f"TopologyNodeFace_{index}", (2.08, 0.16, 1.25), (loc[0], loc[1] - 1.08, loc[2]), mats["graphite"], parent=group, bevel=0.065)
        add_front_frame(f"NodeFrame_{index}", (loc[0], loc[1] - 0.18, loc[2]), (2.18, 2.0, 1.36), mats["orange"], group, thickness=0.045)
        add_text(f"NodeLabel_{index}", label, (loc[0], loc[1] - 1.22, loc[2]), 0.29, mats["warm_bright"], parent=group, font_path=FONT_REGULAR, extrude=0.010)
        add_vent_bank(f"TopologyNodeVent_{index}", (loc[0], loc[1] - 1.18, loc[2] - 0.43), 7, mats["steel"], parent=group, span=1.28, height=0.20, depth=0.065)
        add_indicator_strip(f"TopologyNodeStatus_{index}", (loc[0] - 0.68, loc[1] - 1.18, loc[2] + 0.43), 6, 0.23, mats["orange"], parent=group, radius=0.032)
        for fastener_index, (dx, dz) in enumerate(((-0.90, -0.51), (0.90, -0.51), (-0.90, 0.51), (0.90, 0.51))):
            add_fastener(
                f"TopologyNodeBolt_{index}_{fastener_index}",
                (loc[0] + dx, loc[1] - 1.20, loc[2] + dz),
                mats["chrome"],
                parent=group,
                radius=0.052,
                depth=0.075,
                slot_mat=mats["ink"],
            )
        radial_x = loc[0] - gx
        radial_z = loc[2] - gz
        radial_length = max(math.hypot(radial_x, radial_z), 0.001)
        unit_x = radial_x / radial_length
        unit_z = radial_z / radial_length
        route = [
            (loc[0], loc[1] - 0.1, loc[2]),
            (gx + unit_x * 3.35, (loc[1] + gy) * 0.5, gz + unit_z * 3.35),
            (gx + unit_x * 2.65, gy + 0.55, gz + unit_z * 2.65),
            (gx + unit_x * 2.35, gy + 0.20, gz + unit_z * 2.35),
        ]
        add_curve(f"TopologyRoute_{index}", route, mats["orange"], radius=0.034, parent=group)

    # Cross-connect the service nodes into a redundant neural fabric.
    topology_locs = [loc for _, loc in nodes]
    redundant_edges = ((0, 1), (0, 2), (0, 4), (1, 2), (1, 3), (2, 3), (2, 4), (3, 4))
    for edge_index, (start_index, end_index) in enumerate(redundant_edges):
        start = topology_locs[start_index]
        end = topology_locs[end_index]
        mid_y = (start[1] + end[1]) * 0.5
        add_curve(
            f"TopologyRedundantLink_{edge_index}",
            [
                (start[0], start[1], start[2] + 0.45),
                (
                    (start[0] + end[0]) * 0.5,
                    mid_y,
                    max(gz + 4.20, max(start[2], end[2]) + 1.10 + (edge_index % 2) * 0.35),
                ),
                (end[0], end[1], end[2] + 0.45),
            ],
            mats["orange_dim"],
            radius=0.023 + (edge_index % 3) * 0.004,
            parent=group,
        )

    # Data stars inhabit the cyber half and pulse via their emissive material.
    star_positions: list[tuple[float, float, float]] = []
    for index in range(42):
        angle = index * 2.39996
        radius = 2.0 + (index % 7) * 0.42
        x = cloud_center[0] + math.cos(angle) * radius
        y = cloud_center[1] + math.sin(angle) * radius * 0.82
        z = cloud_center[2] + 0.40 + ((index * 5) % 13) * 0.34
        star_positions.append((x, y, z))
        add_uv_sphere(f"DataStar_{index:02d}", 0.075 + (index % 3) * 0.025, (x, y, z), mats["orange"], parent=group, segments=12, rings=6)

    # Short local synapses add parallax density without drawing one giant web.
    for index in range(0, 42, 2):
        start = star_positions[index]
        end = star_positions[(index + 5 + (index % 7)) % len(star_positions)]
        add_curve(
            f"DataSynapse_{index:02d}",
            [start, ((start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5, (start[2] + end[2]) * 0.5 + 0.18), end],
            mats["orange_dim"],
            radius=0.013,
            parent=group,
        )

    return group


def build_finale_core(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    group = add_group("FinaleCore", 58.0, "finale")
    group["headline"] = "PUT YOUR NEXT SYSTEM IN MOTION."

    center = (0.0, 58.5, 6.0)
    ring_specs = (
        (4.75, mats["chrome"], 0.16),
        (4.08, mats["orange_dim"], 0.085),
        (3.45, mats["steel"], 0.13),
        (2.78, mats["orange"], 0.075),
        (2.16, mats["chrome"], 0.12),
        (1.62, mats["orange_dim"], 0.070),
    )
    for index, (radius, mat, thickness) in enumerate(ring_specs):
        ring = add_torus(f"FinaleRing_{index}", radius, thickness, center, mat, parent=group, rotation=(math.radians(90.0 - (index % 3) * 8.0), index * 0.09, index * 0.18))
        ring["rotationSpeed"] = 0.16 + index * 0.05

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.34, location=center)
    core = bpy.context.object
    core.name = "FinaleEnergyCore"
    core.data.materials.append(mats["graphite"])
    bpy.ops.object.shade_smooth()
    set_parent_keep_world(core, group)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.86, location=(0.0, 58.30, 6.0))
    inner_core = bpy.context.object
    inner_core.name = "FinaleSignalHeart"
    inner_core.data.materials.append(mats["orange"])
    bpy.ops.object.shade_smooth()
    set_parent_keep_world(inner_core, group)
    add_cylinder("FinaleBrandMedallion", 1.10, 0.22, (0.0, 57.10, 6.0), mats["warm_bright"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0), vertices=48)
    add_torus("FinaleBrandBezel", 1.10, 0.07, (0.0, 56.96, 6.0), mats["orange"], parent=group, rotation=(math.radians(90.0), 0.0, 0.0))
    add_text("FinaleMark", "e GAIN", (0.0, 56.91, 6.0), 0.46, mats["ink"], parent=group)

    # Radial turbine vanes and cable sockets give the concentric identity a
    # physical construction rather than leaving it as decorative rings.
    for index in range(16):
        angle = math.tau * index / 16.0
        radius = 3.08
        x = math.cos(angle) * radius
        z = 6.0 + math.sin(angle) * radius
        add_box(
            f"FinaleVane_{index:02d}",
            (1.18, 0.32, 0.20),
            (x, 58.48, z),
            mats["steel"] if index % 2 else mats["graphite"],
            parent=group,
            bevel=0.055,
            rotation=(0.0, 0.0, angle),
        )
        add_cylinder(
            f"FinaleVaneSocket_{index:02d}",
            0.12,
            0.38,
            (math.cos(angle) * 3.68, 58.28, 6.0 + math.sin(angle) * 3.68),
            mats["orange"] if index % 4 == 0 else mats["chrome"],
            parent=group,
            rotation=(math.radians(90.0), 0.0, 0.0),
            vertices=14,
        )

    for side in (-1.0, 1.0):
        add_box(f"FinalePylon_{'L' if side < 0 else 'R'}", (0.62, 2.35, 8.60), (side * 5.55, 59.0, 5.8), mats["graphite"], parent=group, bevel=0.14)
        add_box(f"FinalePylonEdge_{'L' if side < 0 else 'R'}", (0.10, 2.48, 7.85), (side * 5.20, 58.95, 5.8), mats["orange_dim"], parent=group, bevel=0.028)
        for z in (2.2, 5.8, 9.4):
            add_fastener(f"FinalePylonBolt_{'L' if side < 0 else 'R'}_{int(z)}", (side * 5.55, 57.76, z), mats["chrome"], parent=group, radius=0.13, depth=0.16, slot_mat=mats["ink"])

    for index in range(18):
        angle = math.tau * index / 18.0
        radius = 5.15 + (index % 3) * 0.28
        x = math.cos(angle) * radius
        z = 6.0 + math.sin(angle) * radius
        add_box(f"FinaleFragment_{index:02d}", (0.30 + (index % 2) * 0.10, 0.70, 0.30), (x, 58.5, z), mats["steel"] if index % 2 else mats["orange"], parent=group, bevel=0.08, rotation=(angle * 0.4, angle, angle * 0.2))

    # Four signal conduits terminate at peripheral ring sockets.  No spline
    # enters |x| < 1.82m, keeping the central 28% of the Finale composition
    # unobstructed at both the 70-degree rush and the base-FOV CTA landing.
    group["minimumConduitAbsX"] = 1.82
    conduit_specs = (
        (-3.60, -3.10, -2.75, -2.45, 3.75),
        (-2.10, -2.00, -1.90, -1.82, 8.25),
        (2.10, 2.00, 1.90, 1.82, 8.25),
        (3.60, 3.10, 2.75, 2.45, 3.75),
    )
    for index, (start_x, control_a_x, control_b_x, socket_x, socket_z) in enumerate(conduit_specs):
        upper_socket = socket_z > center[2]
        control_a_z = 2.40 if not upper_socket else 3.10
        control_b_z = 3.20 if not upper_socket else 6.70
        add_curve(
            f"FinaleConduit_{index}",
            [
                (start_x, 53.2, 0.65),
                (control_a_x, 55.2, control_a_z),
                (control_b_x, 57.0, control_b_z),
                (socket_x, 58.05, socket_z),
            ],
            mats["orange_dim"] if index % 2 else mats["orange"],
            radius=0.040,
            parent=group,
        )
    return group


def add_web_anchors() -> None:
    stages = (
        ("Boot", -8.0, 2.8),
        ("Build", 4.0, 2.8),
        ("Test", 14.5, 3.6),
        ("Deploy", 25.0, 3.4),
        ("Protect", 35.5, 4.2),
        ("Operate", 45.0, 4.6),
        ("Finale", 54.0, 5.0),
    )
    for name, y, z in stages:
        anchor = bpy.data.objects.new(f"CameraAnchor_{name}", None)
        bpy.context.scene.collection.objects.link(anchor)
        anchor.location = (0.0, y, z)
        anchor.empty_display_type = "ARROWS"
        anchor.empty_display_size = 0.50
        anchor["webZ"] = -y
        anchor["chapter"] = name.lower()


def apply_modifiers(obj: bpy.types.Object) -> None:
    """Bake bevels before joining static geometry so no detail is lost."""
    if obj.type != "MESH":
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for modifier in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except RuntimeError:
            # Export still evaluates any modifier Blender refuses to apply.
            pass
    obj.select_set(False)


def join_meshes(name: str, objects: list[bpy.types.Object]) -> bpy.types.Object | None:
    objects = [obj for obj in objects if obj and obj.type == "MESH" and obj.name in bpy.context.scene.objects]
    if not objects:
        return None
    if len(objects) == 1:
        objects[0].name = name
        return objects[0]

    bpy.ops.object.select_all(action="DESELECT")
    active = objects[0]
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    # Converting the whole selected batch applies bevel/normal modifiers in one
    # depsgraph pass. This is dramatically faster than invoking modifier_apply
    # hundreds of times for screws and fins.
    try:
        bpy.ops.object.convert(target="MESH")
        objects = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
        active = bpy.context.view_layer.objects.active
    except RuntimeError:
        for obj in objects:
            apply_modifiers(obj)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    active = bpy.context.object
    active.name = name
    active.select_set(False)
    return active


def merge_by_material(name: str, objects: list[bpy.types.Object]) -> None:
    buckets: dict[str, list[bpy.types.Object]] = {}
    for obj in objects:
        if obj.type != "MESH" or not obj.data.materials:
            continue
        material_name = obj.data.materials[0].name
        buckets.setdefault(material_name, []).append(obj)
    for index, (material_name, bucket) in enumerate(sorted(buckets.items())):
        safe_material = material_name.replace(" ", "")
        join_meshes(f"{name}_{index:02d}_{safe_material}", bucket)


def add_semantic_group(
    name: str,
    parent: bpy.types.Object,
    sequence_index: int,
    role: str,
) -> bpy.types.Object:
    """Create an animation-safe semantic assembly at its chapter origin."""
    empty = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(empty)
    empty.matrix_world = parent.matrix_world.copy()
    set_parent_keep_world(empty, parent)
    empty.empty_display_type = "CUBE"
    empty.empty_display_size = 0.42
    empty["semanticAssembly"] = role
    empty["sequenceIndex"] = sequence_index
    empty["animationOwner"] = "GSAP"
    empty["chapter"] = parent.get("chapter", "")
    return empty


def organize_semantic_subassemblies(
    groups: dict[str, bpy.types.Object],
) -> dict[str, bpy.types.Object]:
    """Partition every chapter into stable, choreography-ready assemblies.

    Geometry stays in its authored world position. Only its parenting changes,
    so the Ultra and Balanced silhouettes and all camera clearances remain
    identical while the browser gains meaningful animation handles.
    """
    semantic: dict[str, bpy.types.Object] = {}

    definitions: dict[str, tuple[tuple[str, str], ...]] = {
        "build": (
            ("BuildSourceField", "source field"),
            ("BuildShell", "architectural shell"),
            ("BuildMechanics", "mechanical interfaces"),
            ("BuildCore", "system modules"),
            ("BuildEnergy", "signal energy"),
        ),
        "test": (
            ("TestPillars", "verification pillars"),
            ("TestHeaderAssembly", "verification header"),
            ("TestThresholdAssembly", "verification threshold"),
            ("TestScannerAssembly", "moving scanner"),
            ("TestGlassAssembly", "verification field"),
        ),
        "deploy": (
            ("DeployCells", "rack cells"),
            ("DeployCrownAssembly", "deployment crown"),
            ("DeployBuses", "signal buses"),
            ("DeployUplinks", "logical uplinks"),
            ("DeployHeroSignAssembly", "hero sign"),
        ),
        "protect": (
            ("ProtectBlade", "security wipe blade"),
            ("ProtectGateAssembly", "security gate"),
            ("ProtectTiles", "armour tiles"),
            ("ProtectLockAssembly", "security lock"),
        ),
        "cloud": (
            ("OperateCanopy", "compute canopy"),
            ("OperateGimbal", "inference gimbal"),
            ("OperateNetwork", "neural routes"),
            ("OperateNodes", "service and data nodes"),
        ),
        "finale": (
            ("FinaleNucleus", "brand nucleus"),
            ("FinaleEnergyRings", "energy rings"),
            ("FinaleMechanicalRings", "mechanical rings"),
            ("FinaleBrandAssembly", "brand face"),
            ("FinaleConduits", "peripheral conduits"),
            ("FinalePylons", "architectural pylons"),
            ("FinaleFragments", "collapse fragments"),
        ),
    }

    for chapter_key, assembly_definitions in definitions.items():
        chapter = groups[chapter_key]
        for index, (name, role) in enumerate(assembly_definitions):
            semantic[name] = add_semantic_group(name, chapter, index, role)

    def build_target(name: str) -> str:
        if name.startswith(("BuildCoreSlot", "BuildStatusLens", "BuildServicePortRing", "BuildModulePin")):
            return "BuildEnergy"
        if name.startswith(("SourceVoxel", "CodeSlate", "CodeLine")):
            return "BuildSourceField"
        if name.startswith("BuildModule") or name.startswith("BuildCorePerimeter"):
            return "BuildCore"
        if name.startswith((
            "BuildMainBody", "BuildLowerSkid", "BuildUpperSpine", "BuildLeftCheek",
            "BuildRightCheek", "BuildFace", "BuildTitle", "BuildFacePerimeter",
            "BuildPanelSeam", "BuildFaceBolt",
        )):
            return "BuildShell"
        if name.startswith("Build"):
            return "BuildMechanics"
        raise RuntimeError(f"Unclassified Build object: {name}")

    def test_target(name: str) -> str:
        if name == "TestScanner":
            return "TestScannerAssembly"
        if name == "TestGlass":
            return "TestGlassAssembly"
        if name.startswith(("TestPillar", "TestInnerRail", "TestCableRaceway", "TestFootPlate", "GateBolt")):
            return "TestPillars"
        if name.startswith(("TestHeader", "TestTitle")):
            return "TestHeaderAssembly"
        if name.startswith(("TestThreshold", "TestCalibrationTick", "CheckBox", "CheckLabel")):
            return "TestThresholdAssembly"
        raise RuntimeError(f"Unclassified Test object: {name}")

    def deploy_target(name: str) -> str:
        if name.startswith((
            "DeployCell", "DeployFrame", "DeployRack", "DeployPullHandle",
            "DeployBolt", "DeployVent", "DeployRearSpine", "DeployInterlock",
        )):
            return "DeployCells"
        if name.startswith("DeployCrown"):
            return "DeployCrownAssembly"
        if name.startswith("DeployBus"):
            return "DeployBuses"
        if name.startswith("DeployUplink"):
            return "DeployUplinks"
        if name.startswith(("DeployHeroSign", "DeployTitle")):
            return "DeployHeroSignAssembly"
        raise RuntimeError(f"Unclassified Deploy object: {name}")

    def protect_target(name: str) -> str:
        if name.startswith((
            "ProtectDivider", "ProtectEdge", "ProtectFoot", "ProtectArmourCassette",
            "ProtectSpine", "ProtectRivet",
        )):
            return "ProtectBlade"
        if name.startswith(("ProtectGate", "ProtectTitle", "ProtectScan")):
            return "ProtectGateAssembly"
        if name.startswith(("ProtectShieldTile", "ProtectTile")):
            return "ProtectTiles"
        if name.startswith("ProtectLock"):
            return "ProtectLockAssembly"
        raise RuntimeError(f"Unclassified Protect object: {name}")

    def operate_target(name: str) -> str:
        if name.startswith("Cloud"):
            return "OperateCanopy"
        if name.startswith(("NeuralInferenceCore", "NeuralCoreGimbal")):
            return "OperateGimbal"
        if name.startswith(("NeuralSensorLink", "TopologyRoute", "TopologyRedundantLink", "DataSynapse")):
            return "OperateNetwork"
        if name.startswith((
            "NeuralSensor", "TopologyNode", "NodeFrame", "NodeLabel", "DataStar",
        )):
            return "OperateNodes"
        raise RuntimeError(f"Unclassified Operate object: {name}")

    def finale_target(name: str) -> str:
        if name.startswith(("FinaleEnergyCore", "FinaleSignalHeart")):
            return "FinaleNucleus"
        if name.startswith("FinaleRing_"):
            ring_index = int(name.rsplit("_", 1)[1])
            return "FinaleEnergyRings" if ring_index % 2 else "FinaleMechanicalRings"
        if name.startswith(("FinaleVane", "FinaleVaneSocket")):
            return "FinaleMechanicalRings"
        if name.startswith(("FinaleBrandMedallion", "FinaleBrandBezel", "FinaleMark")):
            return "FinaleBrandAssembly"
        if name.startswith("FinaleConduit"):
            return "FinaleConduits"
        if name.startswith("FinalePylon"):
            return "FinalePylons"
        if name.startswith("FinaleFragment"):
            return "FinaleFragments"
        raise RuntimeError(f"Unclassified Finale object: {name}")

    classifiers = {
        "build": build_target,
        "test": test_target,
        "deploy": deploy_target,
        "protect": protect_target,
        "cloud": operate_target,
        "finale": finale_target,
    }
    for chapter_key, classifier in classifiers.items():
        chapter = groups[chapter_key]
        authored_children = [obj for obj in chapter.children if obj.type == "MESH"]
        for obj in authored_children:
            set_parent_keep_world(obj, semantic[classifier(obj.name)])

    return semantic


def optimize_static_geometry(
    groups: dict[str, bpy.types.Object],
    semantic: dict[str, bpy.types.Object],
) -> None:
    """Reduce draw calls inside semantic assemblies without flattening them."""
    environment = groups["environment"]
    merge_by_material("EnvironmentBatch", [obj for obj in environment.children if obj.type == "MESH"])

    signal = groups["signal"]
    merge_by_material("SignalBatch", [obj for obj in signal.children if obj.type == "MESH"])

    for name in ("BuildSourceField", "BuildShell", "BuildMechanics", "BuildCore", "BuildEnergy"):
        merge_by_material(f"{name}Batch", [obj for obj in semantic[name].children if obj.type == "MESH"])

    scanner = next((obj for obj in semantic["TestScannerAssembly"].children if obj.name == "TestScanner"), None)
    if scanner is not None:
        merge_by_material("TestScannerDetailBatch", [obj for obj in scanner.children if obj.type == "MESH"])
    for name in ("TestPillars", "TestHeaderAssembly", "TestThresholdAssembly"):
        preserved = {"TestPillar_L", "TestPillar_R"} if name == "TestPillars" else set()
        merge_by_material(
            f"{name}Batch",
            [obj for obj in semantic[name].children if obj.type == "MESH" and obj.name not in preserved],
        )

    deploy_cells = semantic["DeployCells"]
    merge_by_material(
        "DeployCellsDetailBatch",
        [obj for obj in deploy_cells.children if obj.type == "MESH" and not obj.name.startswith("DeployCell_")],
    )
    for name, preserved in (
        ("DeployCrownAssembly", {"DeployCrown", "DeployCrownFace"}),
        ("DeployBuses", set()),
        ("DeployUplinks", set()),
        ("DeployHeroSignAssembly", {"DeployHeroSign", "DeployTitle"}),
    ):
        merge_by_material(
            f"{name}Batch",
            [obj for obj in semantic[name].children if obj.type == "MESH" and obj.name not in preserved],
        )

    for name in ("ProtectBlade", "ProtectGateAssembly", "ProtectTiles", "ProtectLockAssembly"):
        merge_by_material(f"{name}Batch", [obj for obj in semantic[name].children if obj.type == "MESH"])

    for name, preserved_prefixes in (
        ("OperateCanopy", ()),
        ("OperateGimbal", ("NeuralInferenceCore", "NeuralCoreGimbal")),
        ("OperateNetwork", ()),
        ("OperateNodes", ()),
    ):
        merge_by_material(
            f"{name}Batch",
            [
                obj for obj in semantic[name].children
                if obj.type == "MESH" and not obj.name.startswith(preserved_prefixes)
            ],
        )

    for name, preserved_prefixes in (
        ("FinaleNucleus", ("FinaleEnergyCore", "FinaleSignalHeart")),
        ("FinaleEnergyRings", ("FinaleRing_",)),
        ("FinaleMechanicalRings", ("FinaleRing_",)),
        ("FinaleBrandAssembly", ("FinaleBrandMedallion", "FinaleBrandBezel", "FinaleMark")),
        ("FinaleConduits", ()),
        ("FinalePylons", ()),
        ("FinaleFragments", ()),
    ):
        merge_by_material(
            f"{name}Batch",
            [
                obj for obj in semantic[name].children
                if obj.type == "MESH" and not obj.name.startswith(preserved_prefixes)
            ],
        )


def prepare_balanced_lod() -> None:
    """Attach export-only decimation to distant/repetitive material batches.

    The source .blend and Ultra GLB are saved/exported before this runs. Named
    Chapter and semantic groups, TestScanner/TestGlass and Deploy hero housings
    remain structurally identical; only bevel density in repeated background
    geometry is reduced for the Balanced payload.
    """
    ratios = {
        "EnvironmentBatch": 0.58,
        "SignalBatch": 0.68,
        "BuildSourceFieldBatch": 0.76,
        "BuildShellBatch": 0.86,
        "BuildMechanicsBatch": 0.80,
        "BuildCoreBatch": 0.84,
        "BuildEnergyBatch": 0.90,
        "TestPillarsBatch": 0.84,
        "TestHeaderAssemblyBatch": 0.86,
        "TestThresholdAssemblyBatch": 0.82,
        "TestScannerDetailBatch": 0.88,
        "DeployCellsDetailBatch": 0.76,
        "DeployCrownAssemblyBatch": 0.86,
        "DeployBusesBatch": 0.88,
        "DeployUplinksBatch": 0.84,
        "DeployHeroSignAssemblyBatch": 0.90,
        "ProtectBladeBatch": 0.84,
        "ProtectGateAssemblyBatch": 0.84,
        "ProtectTilesBatch": 0.82,
        "ProtectLockAssemblyBatch": 0.88,
        "OperateCanopyBatch": 0.72,
        "OperateNetworkBatch": 0.74,
        "OperateNodesBatch": 0.76,
        "FinaleMechanicalRingsBatch": 0.84,
        "FinaleConduitsBatch": 0.88,
        "FinalePylonsBatch": 0.84,
        "FinaleFragmentsBatch": 0.80,
    }
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        ratio = next((value for prefix, value in ratios.items() if obj.name.startswith(prefix)), None)
        if ratio is None:
            continue
        modifier = obj.modifiers.new(name="Balanced export decimation", type="DECIMATE")
        modifier.decimate_type = "DISSOLVE"
        modifier.angle_limit = math.radians(2.0 + (1.0 - ratio) * 18.0)
        modifier.use_dissolve_boundaries = False


def scene_stats(label: str) -> None:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    print(
        f"{label}_STATS "
        f"nodes={len(bpy.context.scene.objects)} "
        f"meshes={len(meshes)} "
        f"triangles={triangles} "
        f"materials={len(bpy.data.materials)}"
    )


def configure_scene(scene: bpy.types.Scene) -> bpy.types.Object:
    # Blender 5.1 exposes the Eevee Next renderer under the BLENDER_EEVEE enum.
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.quality = 93
    scene.render.filepath = str(POSTER_PATH)
    scene.render.film_transparent = False
    try:
        scene.render.image_settings.color_depth = "8"
    except TypeError:
        pass
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = 0.35

    world = bpy.data.worlds.new("eGain World") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.0025, 0.003, 0.004, 1.0)
        background.inputs["Strength"].default_value = 0.055

    camera_data = bpy.data.cameras.new("PosterCamera")
    camera = bpy.data.objects.new("PosterCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    # Low, nearly central rail-height view: Build reads on the warm side while
    # Test and Deploy stack into the dark corridor, matching the selected mock.
    camera.location = (-2.2, -16.5, 4.2)
    camera_data.lens = 34.0
    camera_data.sensor_width = 36.0
    camera_data.dof.use_dof = True
    camera_data.dof.focus_distance = 35.0
    camera_data.dof.aperture_fstop = 7.0
    look_at(camera, (0.0, 22.0, 3.4))
    scene.camera = camera

    add_area_light("WarmWorldKey", (-7.0, -3.0, 13.2), (-3.5, 14.0, 3.0), (1.0, 0.82, 0.62), 2450.0, 10.0)
    add_area_light("CorridorFill", (1.0, 7.0, 12.4), (0.0, 24.0, 3.2), (0.76, 0.84, 1.0), 2250.0, 8.5)
    add_area_light("DarkRim", (9.0, 27.0, 11.0), (3.5, 37.0, 4.0), (0.24, 0.38, 0.56), 1750.0, 6.0)
    add_area_light("FinaleBacklight", (0.0, 64.0, 11.0), (0.0, 51.0, 4.5), (1.0, 0.18, 0.025), 1900.0, 7.0)
    for index, loc in enumerate(((-2.0, 5.0, 1.0), (0.0, 17.0, 3.5), (1.5, 29.0, 1.2), (2.8, 38.0, 4.0), (6.0, 49.0, 7.0))):
        add_point_light(f"SignalLight_{index}", loc, (1.0, 0.055, 0.006), 420.0 if index < 3 else 650.0, 1.25)
    return camera


def main() -> None:
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    POSTER_PATH.parent.mkdir(parents=True, exist_ok=True)
    scene = reset_scene()

    mats = {
        # Emission is intentionally below clipping: AgX now retains the orange
        # core instead of mapping the signal rail to featureless white.
        "orange": make_material("Signal Orange", ORANGE, metallic=0.20, roughness=0.20, emission=ORANGE, emission_strength=3.0),
        "orange_dim": make_material("Signal Orange Dim", (0.50, 0.018, 0.003, 1.0), metallic=0.25, roughness=0.26, emission=ORANGE, emission_strength=1.6),
        "warm": make_material("Warm Architectural White", WARM, metallic=0.24, roughness=0.31),
        "warm_bright": make_material("Warm Porcelain", WARM_BRIGHT, metallic=0.08, roughness=0.24),
        "ink": make_material("Ink Black", INK, metallic=0.72, roughness=0.20),
        "graphite": make_material("Graphite", GRAPHITE, metallic=0.82, roughness=0.25),
        "steel": make_material("Brushed Steel", STEEL, metallic=0.92, roughness=0.24),
        "chrome": make_material("Dark Chrome", (0.34, 0.36, 0.37, 1.0), metallic=1.0, roughness=0.13),
        "glass": make_material("Verification Glass", (0.82, 0.90, 0.93, 0.34), metallic=0.05, roughness=0.13, transmission=0.46, alpha=0.34),
    }

    groups = {
        "environment": build_environment(mats),
        "signal": build_signal_rail(mats),
        "build": build_assembly(mats),
        "test": build_test_gate(mats),
        "deploy": build_deploy_array(mats),
        "protect": build_protect_plane(mats),
        "cloud": build_cloud_topology(mats),
        "finale": build_finale_core(mats),
    }
    add_web_anchors()
    configure_scene(scene)
    semantic = organize_semantic_subassemblies(groups)
    optimize_static_geometry(groups, semantic)
    scene_stats("ULTRA")

    # Keep viewport and exporter data stable across machines.
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.select_set(False)
    # Do not create a .blend1 side effect; the generated source itself is the
    # deterministic artifact and can always be rebuilt by this script.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)

    # Web export retains named hierarchy nodes and metadata. It intentionally
    # includes the authored lights/camera as optional reference data.
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_cameras=True,
        # The .blend keeps cinematic area lights; the web runtime supplies its
        # own cheaper lighting rig and therefore does not need embedded lights.
        export_lights=False,
        export_extras=True,
    )

    bpy.context.scene.render.filepath = str(POSTER_PATH)
    bpy.ops.render.render(write_still=True)

    # Balanced keeps the same chapter hierarchy and hero silhouettes while
    # dissolving bevel tessellation in distant/repeated batches.
    prepare_balanced_lod()
    bpy.ops.export_scene.gltf(
        filepath=str(BALANCED_GLB_PATH),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_cameras=True,
        export_lights=False,
        export_extras=True,
    )
    print(f"BLEND={BLEND_PATH}")
    print(f"GLB={GLB_PATH}")
    print(f"BALANCED_GLB={BALANCED_GLB_PATH}")
    print(f"POSTER={POSTER_PATH}")
    print(f"BLEND_BYTES={BLEND_PATH.stat().st_size}")
    print(f"GLB_BYTES={GLB_PATH.stat().st_size}")
    print(f"BALANCED_GLB_BYTES={BALANCED_GLB_PATH.stat().st_size}")
    print(f"POSTER_BYTES={POSTER_PATH.stat().st_size}")


if __name__ == "__main__":
    main()
