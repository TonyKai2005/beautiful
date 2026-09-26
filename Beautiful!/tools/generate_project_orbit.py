#!/usr/bin/env python3
"""Procedurally author the e Gain PROJECT ORBIT Blender master and web assets.

Run with Blender 5.1:

  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python tools/generate_project_orbit.py

The generator is intentionally deterministic.  It creates a Blender-authored
mechanical star system, authored LOD branches, collision/label anchors,
reversible seven-second signature actions, individual Ultra/Balanced GLBs,
system GLBs, nine 4096x2560 Eevee/AgX acceptance frames and a manifest.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
from array import array
from pathlib import Path
from typing import Iterable, Sequence

import bmesh
import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/orbit"
MODELS = OUT / "models"
RENDERS = OUT / "renders"
TEXTURES = OUT / "textures"
BLEND_PATH = OUT / "egain-project-orbit.blend"
MANIFEST_PATH = OUT / "orbit-manifest.json"

FPS = 24
ACTION_END = 168  # Seven seconds, and the end pose equals the start pose.
HERO_WIDTH = 4096
HERO_HEIGHT = 2560
TEXTURE_SIZE = 512
TEXTURE_FILES = {
    "machinedNormal": "orbit-machined-normal.png",
    "opticalNormal": "orbit-optical-normal.png",
    "metalOrm": "orbit-metal-orm.png",
    "dielectricOrm": "orbit-dielectric-orm.png",
    "opticalOrm": "orbit-optical-orm.png",
}

INK = (0.015, 0.019, 0.026, 1.0)
GRAPHITE = (0.065, 0.078, 0.095, 1.0)
GUNMETAL = (0.13, 0.155, 0.18, 1.0)
STEEL = (0.32, 0.35, 0.37, 1.0)
WARM = (0.82, 0.79, 0.73, 1.0)
WARM_BRIGHT = (0.95, 0.92, 0.85, 1.0)
ORANGE = (0.72, 0.023, 0.002, 1.0)
ORANGE_DIM = (0.25, 0.007, 0.001, 1.0)
COLD_GLASS = (0.22, 0.31, 0.38, 0.42)

# Planet-specific material families deliberately stay inside the approved
# black / cold-grey / warm-white language.  The older pass reused the same
# graphite/steel response almost everywhere, so close shots read as one kit of
# parts wrapped around seven spheres.  These values introduce different
# roughness, metal/dielectric response and temperature without turning the
# system into a colourful toy solar system.
CARBON = (0.018, 0.027, 0.038, 1.0)
TITANIUM = (0.205, 0.25, 0.29, 1.0)
NICKEL = (0.46, 0.50, 0.52, 1.0)
COLD_CERAMIC = (0.61, 0.65, 0.66, 1.0)
DARK_CERAMIC = (0.035, 0.052, 0.064, 1.0)
FORGE_OXIDE = (0.115, 0.083, 0.058, 1.0)
OPTICAL_BLUE = (0.115, 0.23, 0.30, 0.36)


PLANETS = (
    {
        "id": "transform",
        "code": "TRANSFORM",
        "service": "Business Transformation",
        "radius": 4.35,
        "orbitRadius": 19.0,
        "angle": 145.0,
        "z": 1.6,
        "signature": "Conversion fault reconfigures legacy and modular hemispheres",
    },
    {
        "id": "build",
        "code": "BUILD",
        "service": "Application Engineering",
        "radius": 4.2,
        "orbitRadius": 21.0,
        "angle": 105.0,
        "z": -1.4,
        "signature": "Foundry modules rise and lock into an engineered world",
    },
    {
        "id": "experience",
        "code": "EXPERIENCE",
        "service": "Mobile & Digital Experience",
        "radius": 4.15,
        "orbitRadius": 22.0,
        "angle": 65.0,
        "z": 2.0,
        "signature": "Adaptive lens and iris alter the planet aperture",
    },
    {
        "id": "test",
        "code": "TEST",
        "service": "Quality Engineering & Validation",
        "radius": 4.35,
        "orbitRadius": 23.0,
        "angle": 25.0,
        "z": -1.0,
        "signature": "Measurement shells separate while the scanner calibrates",
    },
    {
        "id": "deploy",
        "code": "DEPLOY",
        "service": "Cloud & DevOps",
        "radius": 5.05,
        "orbitRadius": 25.5,
        "angle": -15.0,
        "z": 1.0,
        "signature": "Equatorial deployment docks and container rails expand",
    },
    {
        "id": "protect",
        "code": "PROTECT",
        "service": "Cybersecurity & Information Governance",
        "radius": 4.5,
        "orbitRadius": 22.5,
        "angle": -60.0,
        "z": -1.5,
        "signature": "Governance shield petals close into a controlled eclipse",
    },
    {
        "id": "operate",
        "code": "OPERATE",
        "service": "AI & Data",
        "radius": 4.55,
        "orbitRadius": 20.5,
        "angle": -120.0,
        "z": -0.5,
        "signature": "Open inference lattice rotates through causal gimbals",
    },
)


def reset_scene() -> bpy.types.Scene:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.worlds,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)

    scene = bpy.context.scene
    scene.name = "e Gain PROJECT ORBIT"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.frame_start = 1
    scene.frame_end = ACTION_END
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = HERO_WIDTH
    scene.render.resolution_y = HERO_HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.fps = FPS
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = 0.15
    try:
        scene.render.image_settings.color_management = "FOLLOW_SCENE"
    except (AttributeError, TypeError):
        pass

    world = bpy.data.worlds.new("Orbit Void")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.0013, 0.0018, 0.0026, 1.0)
    background.inputs["Strength"].default_value = 0.065
    scene.world = world
    return scene


def principled_input(bsdf: bpy.types.Node, *names: str):
    for name in names:
        socket = bsdf.inputs.get(name)
        if socket is not None:
            return socket
    return None


def save_generated_texture(
    name: str,
    filename: str,
    pixels: array,
) -> bpy.types.Image:
    """Create, save and pack one deterministic non-color web texture."""
    TEXTURES.mkdir(parents=True, exist_ok=True)
    image = bpy.data.images.new(name, width=TEXTURE_SIZE, height=TEXTURE_SIZE, alpha=True, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(pixels)
    image.file_format = "PNG"
    image.filepath_raw = str(TEXTURES / filename)
    image.update()
    image.save()
    image.pack()
    image["projectOrbitTexture"] = True
    image["tileable"] = True
    image["resolution"] = TEXTURE_SIZE
    return image


def create_pbr_texture_library() -> dict[str, bpy.types.Image]:
    """Author compact tileable normal and ORM maps used by every web LOD.

    The textures are deliberately analytical and periodic, so opposite edges
    match exactly and the source remains reproducible without external tools.
    ORM channels are R=ambient occlusion, G=roughness, B=metalness.
    """
    size = TEXTURE_SIZE
    tau = math.tau
    machined_normal = array("f")
    optical_normal = array("f")
    metal_orm = array("f")
    dielectric_orm = array("f")
    optical_orm = array("f")
    for y in range(size):
        v = y / size
        for x in range(size):
            u = x / size

            # Brushed/machined metal: broad mill passes plus fine cross hatch.
            du = (
                0.032 * tau * 6 * math.cos(tau * 6 * u)
                + 0.014 * tau * 17 * math.cos(tau * (17 * u + 3 * v))
                + 0.008 * tau * 29 * math.cos(tau * (29 * u - 5 * v))
            )
            dv = (
                0.03 * tau * 7 * math.cos(tau * 7 * v)
                + 0.014 * tau * 3 * math.cos(tau * (17 * u + 3 * v))
                - 0.008 * tau * 5 * math.cos(tau * (29 * u - 5 * v))
            )
            nx, ny, nz = -du * 0.045, -dv * 0.045, 1.0
            inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
            machined_normal.extend((nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5, 1.0))

            # Optical glass uses a much quieter, concentric micro-wave pattern.
            odu = 0.012 * tau * 4 * math.cos(tau * (4 * u + 2 * v)) + 0.005 * tau * 11 * math.cos(tau * 11 * u)
            odv = 0.012 * tau * 2 * math.cos(tau * (4 * u + 2 * v)) + 0.004 * tau * 9 * math.cos(tau * 9 * v)
            onx, ony, onz = -odu * 0.03, -odv * 0.03, 1.0
            oinv = 1.0 / math.sqrt(onx * onx + ony * ony + onz * onz)
            optical_normal.extend((onx * oinv * 0.5 + 0.5, ony * oinv * 0.5 + 0.5, onz * oinv * 0.5 + 0.5, 1.0))

            grain = 0.5 + 0.5 * math.sin(tau * (13 * u + 7 * v))
            mill = 0.5 + 0.5 * math.sin(tau * 6 * u) * math.sin(tau * 6 * v)
            seam = (abs(math.sin(tau * 4 * u)) * abs(math.sin(tau * 4 * v))) ** 0.35
            ao = min(1.0, max(0.0, 0.76 + 0.2 * seam + 0.04 * grain))
            metal_rough = min(0.46, max(0.16, 0.2 + 0.13 * mill + 0.055 * grain))
            metalness = min(1.0, max(0.0, 0.9 + 0.075 * seam - 0.025 * grain))
            metal_orm.extend((ao, metal_rough, metalness, 1.0))

            dielectric_rough = min(0.56, max(0.2, 0.27 + 0.15 * mill + 0.06 * grain))
            dielectric_orm.extend((min(1.0, ao + 0.04), dielectric_rough, 0.12 + 0.045 * grain, 1.0))

            optical_rough = min(0.22, max(0.065, 0.085 + 0.07 * mill + 0.025 * grain))
            optical_orm.extend((0.98, optical_rough, 0.035, 1.0))

    return {
        "machined_normal": save_generated_texture("ORBIT Machined Normal", "orbit-machined-normal.png", machined_normal),
        "optical_normal": save_generated_texture("ORBIT Optical Normal", "orbit-optical-normal.png", optical_normal),
        "metal_orm": save_generated_texture("ORBIT Metal ORM", "orbit-metal-orm.png", metal_orm),
        "dielectric_orm": save_generated_texture("ORBIT Dielectric ORM", "orbit-dielectric-orm.png", dielectric_orm),
        "optical_orm": save_generated_texture("ORBIT Optical ORM", "orbit-optical-orm.png", optical_orm),
    }


def bind_pbr_textures(
    mat: bpy.types.Material,
    bsdf: bpy.types.Node,
    normal_image: bpy.types.Image,
    orm_image: bpy.types.Image,
    *,
    normal_strength: float,
) -> None:
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    uv = nodes.new("ShaderNodeUVMap")
    uv.name = "PROJECT ORBIT UV"
    uv.uv_map = "UVMap"

    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.name = "PROJECT ORBIT NORMAL"
    normal_texture.label = normal_image.name
    normal_texture.image = normal_image
    normal_texture.interpolation = "Linear"
    normal_texture.extension = "REPEAT"
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.name = "PROJECT ORBIT NORMAL MAP"
    normal_map.space = "TANGENT"
    normal_map.inputs["Strength"].default_value = normal_strength
    links.new(uv.outputs["UV"], normal_texture.inputs["Vector"])
    links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled_input(bsdf, "Normal"))

    orm_texture = nodes.new("ShaderNodeTexImage")
    orm_texture.name = "PROJECT ORBIT ORM"
    orm_texture.label = orm_image.name
    orm_texture.image = orm_image
    orm_texture.interpolation = "Linear"
    orm_texture.extension = "REPEAT"
    separate = nodes.new("ShaderNodeSeparateColor")
    separate.name = "PROJECT ORBIT ORM CHANNELS"
    separate.mode = "RGB"
    links.new(uv.outputs["UV"], orm_texture.inputs["Vector"])
    links.new(orm_texture.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], principled_input(bsdf, "Roughness"))
    links.new(separate.outputs["Blue"], principled_input(bsdf, "Metallic"))
    mat["normalTexture"] = normal_image.name
    mat["ormTexture"] = orm_image.name
    mat["ormChannels"] = "R=AO G=Roughness B=Metalness"


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.35,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    transmission: float = 0.0,
    normal_image: bpy.types.Image | None = None,
    orm_image: bpy.types.Image | None = None,
    normal_strength: float = 0.35,
    coat_weight: float = 0.12,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        principled_input(bsdf, "Base Color").default_value = color
        principled_input(bsdf, "Metallic").default_value = metallic
        principled_input(bsdf, "Roughness").default_value = roughness
        alpha = principled_input(bsdf, "Alpha")
        if alpha:
            alpha.default_value = color[3]
        trans = principled_input(bsdf, "Transmission Weight", "Transmission")
        if trans:
            trans.default_value = transmission
        if emission is not None:
            principled_input(bsdf, "Emission Color", "Emission").default_value = emission
            strength = principled_input(bsdf, "Emission Strength")
            if strength:
                strength.default_value = emission_strength
        coat = principled_input(bsdf, "Coat Weight", "Clearcoat")
        if coat:
            coat.default_value = coat_weight
        coat_roughness = principled_input(bsdf, "Coat Roughness", "Clearcoat Roughness")
        if coat_roughness:
            coat_roughness.default_value = min(0.32, roughness + 0.035)
        if normal_image is not None and orm_image is not None:
            bind_pbr_textures(mat, bsdf, normal_image, orm_image, normal_strength=normal_strength)
    if color[3] < 1.0 or transmission > 0.0:
        try:
            mat.surface_render_method = "DITHERED"
            mat.use_transparency_overlap = False
        except (AttributeError, TypeError):
            pass
    # Opaque hard-surface parts export as glTF FrontSide materials.  Optical
    # glass remains two-sided because its nested lens volumes are visible from
    # both the front aperture and the open rear barrel.
    opaque_hard_surface = color[3] >= 0.999 and transmission <= 0.0
    try:
        mat.use_backface_culling = opaque_hard_surface
    except (AttributeError, TypeError):
        pass
    mat["doubleSided"] = not opaque_hard_surface
    mat["pbrRole"] = name
    return mat


def create_materials() -> dict[str, bpy.types.Material]:
    textures = create_pbr_texture_library()
    metal = {"normal_image": textures["machined_normal"], "orm_image": textures["metal_orm"]}
    dielectric = {"normal_image": textures["machined_normal"], "orm_image": textures["dielectric_orm"]}
    optical = {"normal_image": textures["optical_normal"], "orm_image": textures["optical_orm"]}
    return {
        "ink": material("ORBIT / Ink Black", INK, metallic=0.86, roughness=0.19, normal_strength=0.12, **metal),
        "graphite": material("ORBIT / Graphite", GRAPHITE, metallic=0.82, roughness=0.26, normal_strength=0.18, **metal),
        "gunmetal": material("ORBIT / Gunmetal", GUNMETAL, metallic=0.94, roughness=0.22, normal_strength=0.24, **metal),
        "steel": material("ORBIT / Brushed Steel", STEEL, metallic=0.98, roughness=0.21, normal_strength=0.28, **metal),
        "warm": material("ORBIT / Warm Architectural White", WARM, metallic=0.22, roughness=0.29, normal_strength=0.1, coat_weight=0.2, **dielectric),
        "warm_bright": material("ORBIT / Warm Porcelain", WARM_BRIGHT, metallic=0.08, roughness=0.24, normal_strength=0.07, coat_weight=0.24, **dielectric),
        "orange": material(
            "ORBIT / Signal Orange",
            ORANGE,
            metallic=0.22,
            roughness=0.2,
            emission=(1.0, 0.028, 0.001, 1.0),
            emission_strength=1.85,
            normal_strength=0.08,
            **dielectric,
        ),
        "orange_dim": material(
            "ORBIT / Signal Orange Dim",
            ORANGE_DIM,
            metallic=0.35,
            roughness=0.23,
            emission=(0.8, 0.018, 0.001, 1.0),
            emission_strength=0.65,
            normal_strength=0.12,
            **dielectric,
        ),
        "glass": material(
            "ORBIT / Cold Optical Glass",
            COLD_GLASS,
            metallic=0.2,
            roughness=0.12,
            transmission=0.24,
            normal_strength=0.07,
            coat_weight=0.28,
            **optical,
        ),
        # World-specific finishes.  Material names are stable and descriptive
        # so they remain inspectable in the Blender master and exported GLBs.
        "carbon": material(
            "ORBIT / Layered Carbon Armour",
            CARBON,
            metallic=0.48,
            roughness=0.42,
            normal_strength=0.2,
            coat_weight=0.08,
            **dielectric,
        ),
        "titanium": material(
            "ORBIT / Cold Titanium",
            TITANIUM,
            metallic=0.98,
            roughness=0.17,
            normal_strength=0.32,
            coat_weight=0.08,
            **metal,
        ),
        "nickel": material(
            "ORBIT / Satin Nickel",
            NICKEL,
            metallic=0.96,
            roughness=0.31,
            normal_strength=0.18,
            coat_weight=0.05,
            **metal,
        ),
        "ceramic": material(
            "ORBIT / Cold Engineering Ceramic",
            COLD_CERAMIC,
            metallic=0.1,
            roughness=0.34,
            normal_strength=0.08,
            coat_weight=0.26,
            **dielectric,
        ),
        "ceramic_dark": material(
            "ORBIT / Dark Technical Ceramic",
            DARK_CERAMIC,
            metallic=0.12,
            roughness=0.37,
            normal_strength=0.09,
            coat_weight=0.22,
            **dielectric,
        ),
        "forge_oxide": material(
            "ORBIT / Heat Treated Forge Alloy",
            FORGE_OXIDE,
            metallic=0.76,
            roughness=0.4,
            normal_strength=0.3,
            coat_weight=0.04,
            **metal,
        ),
        "optical_blue": material(
            "ORBIT / Deep Optical Glass",
            OPTICAL_BLUE,
            metallic=0.08,
            roughness=0.085,
            transmission=0.42,
            normal_strength=0.045,
            coat_weight=0.38,
            **optical,
        ),
    }


def add_empty(
    name: str,
    *,
    parent: bpy.types.Object | None = None,
    loc: Sequence[float] = (0.0, 0.0, 0.0),
    display: str = "PLAIN_AXES",
    size: float = 0.5,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.empty_display_type = display
    obj.empty_display_size = size
    return obj


def add_box(
    name: str,
    dims: Sequence[float],
    loc: Sequence[float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    bevel: float = 0.055,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = parent
    # Parenting after primitive creation interprets the authored coordinates as
    # local coordinates, which is what the asset roots need.
    obj.location = loc
    if bevel > 0.0:
        mod = obj.modifiers.new("Machined edge", "BEVEL")
        mod.width = min(bevel, min(dims) * 0.22)
        mod.segments = 2 if min(dims) > 0.11 else 1
        mod.limit_method = "ANGLE"
        if min(dims) > 0.12:
            try:
                weighted = obj.modifiers.new("Weighted hard-surface normals", "WEIGHTED_NORMAL")
                weighted.keep_sharp = True
                weighted.weight = 45
            except (RuntimeError, AttributeError, TypeError):
                pass
    obj.data.materials.append(mat)
    return obj


def add_cylinder(
    name: str,
    radius: float,
    depth: float,
    loc: Sequence[float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    vertices: int = 20,
    bevel: float = 0.035,
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
    obj.parent = parent
    obj.location = loc
    obj.data.materials.append(mat)
    if bevel > 0.0:
        mod = obj.modifiers.new("Radial edge", "BEVEL")
        mod.width = min(bevel, radius * 0.18, depth * 0.15)
        mod.segments = 2 if radius > 0.18 else 1
        mod.limit_method = "ANGLE"
        if radius > 0.14 and depth > 0.14:
            try:
                weighted = obj.modifiers.new("Weighted radial normals", "WEIGHTED_NORMAL")
                weighted.keep_sharp = True
                weighted.weight = 35
            except (RuntimeError, AttributeError, TypeError):
                pass
    return obj


def add_ico(
    name: str,
    radius: float,
    loc: Sequence[float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    subdivisions: int = 2,
    scale: Sequence[float] = (1.0, 1.0, 1.0),
    smooth: bool = False,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = loc
    obj.scale = scale
    obj.data.materials.append(mat)
    if not obj.data.uv_layers:
        uv_layer = obj.data.uv_layers.new(name="UVMap")
        for loop in obj.data.loops:
            co = obj.data.vertices[loop.vertex_index].co.normalized()
            uv_layer.data[loop.index].uv = (
                math.atan2(co.y, co.x) / math.tau + 0.5,
                math.acos(max(-1.0, min(1.0, co.z))) / math.pi,
            )
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def add_uv_sphere(
    name: str,
    radius: float,
    loc: Sequence[float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    segments: int = 32,
    rings: int = 16,
    scale: Sequence[float] = (1.0, 1.0, 1.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=radius,
        location=loc,
    )
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = loc
    obj.scale = scale
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_torus(
    name: str,
    major: float,
    minor: float,
    loc: Sequence[float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    scale: Sequence[float] = (1.0, 1.0, 1.0),
    major_segments: int = 48,
    minor_segments: int = 8,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=loc,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = loc
    obj.scale = scale
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_extruded_profile(
    name: str,
    outline: Sequence[tuple[float, float]],
    depth: float,
    loc: Sequence[float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    bevel: float = 0.055,
) -> bpy.types.Object:
    """Extrude a custom X/Z hard-surface profile through local Y.

    A small vocabulary of authored profiles gives the planets recognisable
    silhouettes without depending on primitive cubes or complete toruses.  The
    closed side walls, second-order bevel and projected UVs remain glTF-safe.
    """
    if len(outline) < 3:
        raise ValueError("An extruded profile requires at least three points")
    vertices: list[tuple[float, float, float]] = []
    for y in (-depth * 0.5, depth * 0.5):
        vertices.extend((x, y, z) for x, z in outline)
    count = len(outline)
    faces: list[tuple[int, ...]] = [
        tuple(reversed(range(count))),
        tuple(range(count, count * 2)),
    ]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    recalculate_closed_mesh_outside(mesh)
    span_x = max(x for x, _ in outline) - min(x for x, _ in outline)
    span_z = max(z for _, z in outline) - min(z for _, z in outline)
    add_projected_uv(mesh, max(span_x, 0.1), max(span_z, 0.1))
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rotation
    obj["hardSurfaceLayer"] = "authored closed mechanical profile"
    if bevel > 0.0:
        edge = obj.modifiers.new("Secondary profile bevel", "BEVEL")
        edge.width = min(bevel, depth * 0.2)
        edge.segments = 2
        edge.limit_method = "ANGLE"
        try:
            weighted = obj.modifiers.new("Profile weighted normals", "WEIGHTED_NORMAL")
            weighted.keep_sharp = True
            weighted.weight = 42
        except (RuntimeError, AttributeError, TypeError):
            pass
    return obj


def surface_tangent_frame(normal: Vector) -> tuple[Vector, Vector, Vector]:
    """Return deterministic tangent, bitangent and normal vectors."""
    n = normal.normalized()
    reference = Vector((0.0, 0.0, 1.0)) if abs(n.z) < 0.88 else Vector((1.0, 0.0, 0.0))
    tangent = reference.cross(n).normalized()
    bitangent = n.cross(tangent).normalized()
    return tangent, bitangent, n


def add_recessed_service_panel(
    prefix: str,
    normal: Vector,
    radius: float,
    width: float,
    height: float,
    mats: dict[str, bpy.types.Material],
    *,
    parent: bpy.types.Object,
    housing_mat: str = "carbon",
    face_mat: str = "titanium",
    signal: bool = False,
    port: bool = True,
    twist: float = 0.0,
) -> bpy.types.Object:
    """Create a layered service cassette with a true recess and fasteners."""
    tangent, bitangent, n = surface_tangent_frame(normal)
    housing = add_panel_on_sphere(
        f"{prefix}_Housing",
        n,
        radius,
        (width, height, 0.19),
        mats[housing_mat],
        parent=parent,
        twist=twist,
    )
    housing["assemblyRole"] = "recessed service cassette load plate"
    inset = add_panel_on_sphere(
        f"{prefix}_Recess",
        n,
        radius + 0.105,
        (width * 0.72, height * 0.64, 0.07),
        mats[face_mat],
        parent=parent,
        twist=twist,
    )
    inset["panelSeam"] = True
    centre = n * (radius + 0.17)
    for corner, (u_sign, v_sign) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
        point = centre + tangent * (u_sign * width * 0.38) + bitangent * (v_sign * height * 0.35)
        bolt = add_cylinder(
            f"{prefix}_QuarterTurnFastener_{corner}",
            min(width, height) * 0.055,
            0.075,
            point,
            mats["nickel"],
            parent=parent,
            vertices=12,
            bevel=0.012,
        )
        orient_z_to(bolt, n)
    if port:
        port_point = centre - tangent * width * 0.19
        connector = add_cylinder(
            f"{prefix}_InterfaceSocket",
            min(width, height) * 0.14,
            0.13,
            port_point,
            mats["ceramic_dark"],
            parent=parent,
            vertices=16,
            bevel=0.02,
        )
        orient_z_to(connector, n)
        pin = add_cylinder(
            f"{prefix}_InterfacePin",
            min(width, height) * 0.055,
            0.17,
            port_point + n * 0.06,
            mats["warm"],
            parent=parent,
            vertices=10,
            bevel=0.012,
        )
        orient_z_to(pin, n)
    if signal:
        signal_point = centre + tangent * width * 0.21
        marker = add_box(
            f"{prefix}_SignalKey",
            (width * 0.26, max(height * 0.055, 0.055), 0.035),
            signal_point,
            mats["orange_dim"],
            parent=parent,
            bevel=0.012,
        )
        orient_z_to(marker, n)
    return housing


def add_bearing_stack(
    prefix: str,
    loc: Sequence[float],
    axis: Vector,
    mats: dict[str, bpy.types.Material],
    *,
    parent: bpy.types.Object,
    radius: float = 0.28,
    depth: float = 0.42,
    signal: bool = False,
) -> bpy.types.Object:
    """Layered bearing/actuator with housing, collar, axle and signal cap."""
    housing = add_cylinder(prefix, radius, depth, loc, mats["carbon"], parent=parent, vertices=20, bevel=0.04)
    orient_z_to(housing, axis)
    collar = add_cylinder(
        f"{prefix}_Collar",
        radius * 0.72,
        depth * 1.14,
        loc,
        mats["titanium"],
        parent=parent,
        vertices=18,
        bevel=0.025,
    )
    orient_z_to(collar, axis)
    axle = add_cylinder(
        f"{prefix}_Axle",
        radius * 0.27,
        depth * 1.34,
        loc,
        mats["orange_dim" if signal else "nickel"],
        parent=parent,
        vertices=12,
        bevel=0.014,
    )
    orient_z_to(axle, axis)
    return housing


def add_grid_uv(mesh: bpy.types.Mesh, columns: int, rows: int) -> None:
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        vertex_index = loop.vertex_index
        column = vertex_index % columns
        row = vertex_index // columns
        uv_layer.data[loop.index].uv = (
            column / max(columns - 1, 1),
            row / max(rows - 1, 1),
        )


def add_projected_uv(mesh: bpy.types.Mesh, span_x: float, span_z: float) -> None:
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        uv_layer.data[loop.index].uv = (
            co.x / max(span_x, 1e-5) + 0.5,
            co.z / max(span_z, 1e-5) + 0.5,
        )


def recalculate_closed_mesh_outside(mesh: bpy.types.Mesh) -> None:
    """Make a closed procedural mesh consistently outward-facing.

    The web materials intentionally export as glTF FrontSide.  Hand-authored
    profile outlines are not required to share one clockwise convention, so
    relying on face construction order can silently make an otherwise valid
    planet disappear once backface culling is enabled.  BMesh's closed-volume
    normal pass gives every profile, annular sector and iris leaf a robust
    outside orientation before UVs and modifiers are added.
    """
    mesh.validate(clean_customdata=False)
    mesh.update(calc_edges=True)
    working = bmesh.new()
    try:
        working.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(working, faces=list(working.faces))
        working.to_mesh(mesh)
    finally:
        working.free()
    mesh.validate(clean_customdata=False)
    mesh.update(calc_edges=True)


def add_spherical_patch(
    name: str,
    radius: float,
    theta_start: float,
    theta_end: float,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    theta_segments: int = 20,
    phi_segments: int = 18,
    thickness: float = 0.12,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for p in range(phi_segments + 1):
        phi = math.pi * p / phi_segments
        for t in range(theta_segments + 1):
            theta = theta_start + (theta_end - theta_start) * t / theta_segments
            vertices.append(
                (
                    radius * math.sin(phi) * math.cos(theta),
                    radius * math.sin(phi) * math.sin(theta),
                    radius * math.cos(phi),
                )
            )
    row = theta_segments + 1
    for p in range(phi_segments):
        for t in range(theta_segments):
            a = p * row + t
            # theta x phi points inward for this parameterisation; reverse it
            # so the authored shell remains visible with FrontSide materials.
            faces.append((a, a + row, a + row + 1, a + 1))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    add_grid_uv(mesh, theta_segments + 1, phi_segments + 1)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    solid = obj.modifiers.new("Armoured shell thickness", "SOLIDIFY")
    solid.thickness = thickness
    solid.offset = 0.0
    bevel = obj.modifiers.new("Shell seam bevel", "BEVEL")
    bevel.width = min(0.055, thickness * 0.35)
    bevel.segments = 2
    return obj


def add_spherical_tile(
    name: str,
    radius: float,
    theta_start: float,
    theta_end: float,
    phi_start: float,
    phi_end: float,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    theta_segments: int = 5,
    phi_segments: int = 5,
    thickness: float = 0.18,
    bevel_width: float = 0.045,
) -> bpy.types.Object:
    """Add one curved, physically thick armour tile with open seams."""
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for p in range(phi_segments + 1):
        phi = phi_start + (phi_end - phi_start) * p / phi_segments
        for t in range(theta_segments + 1):
            theta = theta_start + (theta_end - theta_start) * t / theta_segments
            vertices.append(
                (
                    radius * math.sin(phi) * math.cos(theta),
                    radius * math.sin(phi) * math.sin(theta),
                    radius * math.cos(phi),
                )
            )
    row = theta_segments + 1
    for p in range(phi_segments):
        for t in range(theta_segments):
            a = p * row + t
            # theta x phi points inward for this parameterisation; reverse it
            # so the authored armour tile faces away from the planet centre.
            faces.append((a, a + row, a + row + 1, a + 1))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    add_grid_uv(mesh, theta_segments + 1, phi_segments + 1)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj["hardSurfaceLayer"] = "thick curved armour"
    obj["panelSeam"] = True
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    solid = obj.modifiers.new("Armour wall thickness", "SOLIDIFY")
    solid.thickness = thickness
    solid.offset = 0.0
    bevel = obj.modifiers.new("Machined panel edge", "BEVEL")
    bevel.width = min(bevel_width, thickness * 0.28)
    bevel.segments = 2
    return obj


def add_segmented_armour_shell(
    prefix: str,
    parent: bpy.types.Object,
    radius: float,
    mats: dict[str, bpy.types.Material],
    *,
    bands: int = 4,
    segments: int = 10,
    theta_start: float = -math.pi,
    theta_end: float = math.pi,
    phi_start: float = 0.14,
    phi_end: float = math.pi - 0.14,
    thickness: float = 0.18,
    material_cycle: Sequence[str] = ("graphite", "gunmetal", "steel"),
    skip: set[tuple[int, int]] | None = None,
    fastener_stride: int = 5,
    tile_theta_segments: int = 5,
    tile_phi_segments: int = 4,
) -> list[bpy.types.Object]:
    """Build a gapped shell from curved plates instead of a reskinned ball."""
    shell = add_empty(f"{prefix}_ArmourShell", parent=parent)
    shell["assemblyRole"] = "layered load-bearing shell"
    tiles: list[bpy.types.Object] = []
    theta_span = theta_end - theta_start
    phi_span = phi_end - phi_start
    theta_gap = min(0.045, abs(theta_span) / max(segments, 1) * 0.16)
    phi_gap = min(0.055, abs(phi_span) / max(bands, 1) * 0.18)
    for band in range(bands):
        p0 = phi_start + phi_span * band / bands + phi_gap
        p1 = phi_start + phi_span * (band + 1) / bands - phi_gap
        for segment in range(segments):
            if skip and (band, segment) in skip:
                continue
            t0 = theta_start + theta_span * segment / segments + theta_gap
            t1 = theta_start + theta_span * (segment + 1) / segments - theta_gap
            mat_name = material_cycle[(band * 3 + segment) % len(material_cycle)]
            tile = add_spherical_tile(
                f"{prefix}_ArmourTile_{band:02d}_{segment:02d}",
                radius + 0.035 * ((band + segment) % 2),
                t0,
                t1,
                p0,
                p1,
                mats[mat_name],
                parent=shell,
                theta_segments=tile_theta_segments,
                phi_segments=tile_phi_segments,
                thickness=thickness + 0.035 * ((band + segment) % 3 == 0),
            )
            tiles.append(tile)
            if fastener_stride > 0 and (band * segments + segment) % fastener_stride == 0:
                theta = (t0 + t1) * 0.5
                phi = (p0 + p1) * 0.5
                normal = Vector((math.sin(phi) * math.cos(theta), math.sin(phi) * math.sin(theta), math.cos(phi)))
                add_bolt_on_sphere(
                    f"{prefix}_ArmourFastener_{band:02d}_{segment:02d}",
                    normal,
                    radius + thickness * 0.64,
                    mats["warm"],
                    parent=shell,
                    size=0.07,
                )
    return tiles


def add_structural_cage(
    prefix: str,
    parent: bpy.types.Object,
    inner_radius: float,
    outer_radius: float,
    mats: dict[str, bpy.types.Material],
    *,
    ring_minor: float = 0.16,
    strut_count: int = 10,
    ring_count: int = 3,
) -> bpy.types.Object:
    cage = add_empty(f"{prefix}_StructuralCage", parent=parent)
    cage["assemblyRole"] = "causal load path between core and armour"
    rotations = ((0, 0, 0), (math.pi / 2, 0, 0), (0, math.pi / 2, 0))[:ring_count]
    for index, rotation in enumerate(rotations):
        add_torus(
            f"{prefix}_LoadRing_{index}",
            outer_radius * (0.84 + index * 0.035),
            ring_minor,
            (0, 0, 0),
            mats["gunmetal" if index < 2 else "steel"],
            parent=cage,
            rotation=rotation,
            major_segments=48,
            minor_segments=8,
        )
    for index in range(strut_count):
        latitude = -0.72 + 1.44 * ((index * 5) % strut_count) / max(strut_count - 1, 1)
        normal = radial_vector(index, strut_count, latitude=latitude, offset=0.13)
        add_cylinder_between(
            f"{prefix}_LoadStrut_{index:02d}",
            normal * inner_radius,
            normal * outer_radius,
            0.075 if index % 3 else 0.105,
            mats["steel" if index % 2 else "gunmetal"],
            parent=cage,
            vertices=12,
        )
        add_cylinder(
            f"{prefix}_StrutHinge_{index:02d}",
            0.13,
            0.18,
            normal * outer_radius,
            mats["warm" if index % 3 else "orange_dim"],
            parent=cage,
            vertices=14,
            bevel=0.025,
        )
        orient_z_to(bpy.context.object, normal)
    return cage


def add_annular_sector(
    name: str,
    inner_radius: float,
    outer_radius: float,
    angle_start: float,
    angle_end: float,
    depth: float,
    loc_y: float,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    steps: int = 7,
    scale_x: float = 1.0,
    scale_z: float = 1.0,
    bevel_width: float = 0.035,
) -> bpy.types.Object:
    """Create a thick annular lens/iris segment in the camera-facing XZ plane."""
    vertices: list[tuple[float, float, float]] = []
    for y in (loc_y - depth * 0.5, loc_y + depth * 0.5):
        for radius in (inner_radius, outer_radius):
            for step in range(steps + 1):
                angle = angle_start + (angle_end - angle_start) * step / steps
                vertices.append((math.cos(angle) * radius * scale_x, y, math.sin(angle) * radius * scale_z))
    stride = steps + 1
    faces: list[tuple[int, int, int, int]] = []
    # Front/back annular strips.
    for side in range(2):
        base = side * stride * 2
        for step in range(steps):
            quad = (base + step, base + step + 1, base + stride + step + 1, base + stride + step)
            faces.append(quad if side == 0 else tuple(reversed(quad)))
    # Inner/outer walls plus radial caps.
    for radius_index in range(2):
        a = radius_index * stride
        b = stride * 2 + radius_index * stride
        for step in range(steps):
            faces.append((a + step, b + step, b + step + 1, a + step + 1))
    for step in (0, steps):
        faces.append((step, stride + step, stride * 3 + step, stride * 2 + step))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    recalculate_closed_mesh_outside(mesh)
    add_projected_uv(mesh, outer_radius * scale_x * 2.0, outer_radius * scale_z * 2.0)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj["hardSurfaceLayer"] = "thick segmented optical/mechanical sector"
    bevel = obj.modifiers.new("Sector edge bevel", "BEVEL")
    bevel.width = min(bevel_width, depth * 0.22)
    bevel.segments = 2
    return obj


def add_iris_leaf(
    name: str,
    index: int,
    count: int,
    inner_radius: float,
    outer_radius: float,
    depth: float,
    loc_y: float,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    scale_x: float = 1.0,
    scale_z: float = 1.0,
    bevel_width: float = 0.04,
) -> bpy.types.Object:
    """Create one hooked, overlapping mechanical iris leaf."""
    step = math.tau / count
    centre = step * index
    polar_points = (
        (inner_radius, centre - step * 0.18),
        (inner_radius * 0.92, centre + step * 0.34),
        (outer_radius * 0.64, centre + step * 0.67),
        (outer_radius, centre + step * 0.52),
        (outer_radius, centre - step * 0.58),
        (outer_radius * 0.62, centre - step * 0.52),
        (inner_radius * 1.18, centre - step * 0.34),
    )
    outline = [
        (math.cos(angle) * radius * scale_x, math.sin(angle) * radius * scale_z)
        for radius, angle in polar_points
    ]
    vertices: list[tuple[float, float, float]] = []
    for y in (loc_y - depth * 0.5, loc_y + depth * 0.5):
        vertices.extend((x, y, z) for x, z in outline)
    side_count = len(outline)
    faces: list[tuple[int, ...]] = [
        tuple(range(side_count)),
        tuple(reversed(range(side_count, side_count * 2))),
    ]
    for point in range(side_count):
        nxt = (point + 1) % side_count
        faces.append((point, nxt, side_count + nxt, side_count + point))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    recalculate_closed_mesh_outside(mesh)
    add_projected_uv(mesh, outer_radius * scale_x * 2.0, outer_radius * scale_z * 2.0)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj["hardSurfaceLayer"] = "overlapping articulated iris leaf"
    obj["irisLeaf"] = index
    bevel = obj.modifiers.new("Iris leaf edge bevel", "BEVEL")
    bevel.width = min(bevel_width, depth * 0.2)
    bevel.segments = 2
    return obj


def add_segmented_gimbal(
    prefix: str,
    parent: bpy.types.Object,
    radius: float,
    mats: dict[str, bpy.types.Material],
    *,
    rotation: Sequence[float] = (0.0, 0.0, 0.0),
    segments: int = 12,
    radial_width: float = 0.34,
    depth: float = 0.34,
    steps: int = 5,
) -> bpy.types.Object:
    """Build a machined gimbal from discrete rails and bearing drums."""
    axis = add_empty(f"{prefix}_ACTION", parent=parent)
    axis.rotation_euler = rotation
    axis["assemblyRole"] = "segmented articulated gimbal"
    for segment in range(segments):
        gap = 0.028
        add_annular_sector(
            f"{prefix}_RailSector_{segment:02d}",
            radius - radial_width * 0.5,
            radius + radial_width * 0.5,
            math.tau * segment / segments + gap,
            math.tau * (segment + 1) / segments - gap,
            depth,
            0.0,
            mats["titanium" if segment % 3 else "carbon"],
            parent=axis,
            steps=steps,
            bevel_width=min(0.055, radial_width * 0.16),
        )
        if segment % max(segments // 4, 1) == 0:
            theta = math.tau * (segment + 0.5) / segments
            point = Vector((math.cos(theta) * radius, 0, math.sin(theta) * radius))
            add_cylinder(
                f"{prefix}_BearingDrum_{segment:02d}",
                radial_width * 0.68,
                depth * 1.7,
                point,
                mats["nickel"],
                parent=axis,
                rotation=(math.pi / 2, 0, 0),
                vertices=16,
                bevel=0.035,
            )
            add_cylinder(
                f"{prefix}_BearingPin_{segment:02d}",
                radial_width * 0.24,
                depth * 2.0,
                point,
                mats["orange_dim"],
                parent=axis,
                rotation=(math.pi / 2, 0, 0),
                vertices=12,
                bevel=0.018,
            )
    return axis


def orient_z_to(obj: bpy.types.Object, direction: Vector) -> None:
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.normalized().to_track_quat("Z", "Y")


def add_panel_on_sphere(
    name: str,
    normal: Vector,
    radius: float,
    dims: Sequence[float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    twist: float = 0.0,
) -> bpy.types.Object:
    obj = add_box(name, dims, normal.normalized() * radius, mat, parent=parent, bevel=0.045)
    orient_z_to(obj, normal)
    if twist:
        obj.rotation_mode = "XYZ"
        q = normal.normalized().to_track_quat("Z", "Y")
        obj.rotation_euler = q.to_euler()
        obj.rotation_euler.rotate_axis("Z", twist)
    return obj


def add_bolt_on_sphere(
    name: str,
    normal: Vector,
    radius: float,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    size: float = 0.075,
) -> bpy.types.Object:
    obj = add_cylinder(name, size, size * 0.7, normal.normalized() * radius, mat, parent=parent, vertices=12, bevel=0.012)
    orient_z_to(obj, normal)
    return obj


def add_cylinder_between(
    name: str,
    start: Vector,
    end: Vector,
    radius: float,
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    vertices: int = 10,
) -> bpy.types.Object:
    delta = end - start
    obj = add_cylinder(
        name,
        radius,
        delta.length,
        (start + end) * 0.5,
        mat,
        parent=parent,
        vertices=vertices,
        bevel=0.0,
    )
    orient_z_to(obj, delta)
    return obj


def radial_vector(index: int, count: int, *, latitude: float = 0.0, offset: float = 0.0) -> Vector:
    theta = offset + math.tau * index / count
    z = math.sin(latitude)
    radial = math.cos(latitude)
    return Vector((math.cos(theta) * radial, math.sin(theta) * radial, z))


def keyframe_cycle(
    obj: bpy.types.Object,
    *,
    peak_location: Sequence[float] | None = None,
    peak_rotation: Sequence[float] | None = None,
    peak_scale: Sequence[float] | None = None,
    action_name: str,
) -> None:
    start_loc = obj.location.copy()
    start_rot = obj.rotation_euler.copy()
    start_scale = obj.scale.copy()
    obj.rotation_mode = "XYZ"
    for frame in (1, ACTION_END):
        obj.location = start_loc
        obj.rotation_euler = start_rot
        obj.scale = start_scale
        obj.keyframe_insert("location", frame=frame)
        obj.keyframe_insert("rotation_euler", frame=frame)
        obj.keyframe_insert("scale", frame=frame)
    obj.location = Vector(peak_location) if peak_location is not None else start_loc
    obj.rotation_euler = Vector(peak_rotation) if peak_rotation is not None else start_rot
    obj.scale = Vector(peak_scale) if peak_scale is not None else start_scale
    obj.keyframe_insert("location", frame=84)
    obj.keyframe_insert("rotation_euler", frame=84)
    obj.keyframe_insert("scale", frame=84)
    obj.location = start_loc
    obj.rotation_euler = start_rot
    obj.scale = start_scale
    if obj.animation_data and obj.animation_data.action:
        obj.animation_data.action.name = action_name
        # Blender 5 actions are layered and no longer expose Action.fcurves;
        # keyframe_insert already authors Bezier interpolation by default.
        for fcurve in getattr(obj.animation_data.action, "fcurves", ()):
            for point in fcurve.keyframe_points:
                point.interpolation = "BEZIER"


def asset_root(
    root_name: str,
    *,
    parent: bpy.types.Object,
    loc: Sequence[float],
    asset_id: str,
    service: str,
    radius: float,
    signature: str,
) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    root = add_empty(root_name, parent=parent, loc=loc, display="SPHERE", size=radius)
    root["orbitAsset"] = asset_id
    root["service"] = service
    root["boundingRadius"] = radius
    root["designSignature"] = signature
    root["coordinateConvention"] = "Blender Z-up / glTF Y-up"
    root["actionDurationSeconds"] = ACTION_END / FPS
    lod0 = add_empty(f"{root_name}_WEB_LOD0", parent=root)
    lod1 = add_empty(f"{root_name}_WEB_LOD1", parent=root)
    lod2 = add_empty(f"{root_name}_WEB_LOD2", parent=root)
    for index, lod in enumerate((lod0, lod1, lod2)):
        lod["lod"] = index
        lod["webRenderable"] = True
        lod.hide_render = index != 0
        lod.hide_set(index != 0)
    # The web collision node is metadata-only.  Exporting a black ico mesh here
    # caused the runtime loader to render it and include it in visual bounds,
    # hiding the detailed planet behind an apparent low-poly black sphere.
    collision = add_empty(
        f"{root_name}_COLLISION",
        parent=root,
        display="SPHERE",
        size=radius,
    )
    collision["collisionOnly"] = True
    collision["collisionShape"] = "sphere"
    collision["collisionRadius"] = radius
    collision.hide_render = True
    collision.hide_set(True)
    # A real wire proxy remains available to Blender reviewers but its name is
    # intentionally excluded by selection_for_asset() and never reaches GLB.
    collision_source = add_ico(
        f"{root_name}_COLLISION_SOURCE",
        radius,
        (0.0, 0.0, 0.0),
        bpy.data.materials["ORBIT / Ink Black"],
        parent=root,
        subdivisions=1,
    )
    collision_source["collisionAuthoringProxy"] = True
    collision_source.display_type = "WIRE"
    collision_source.hide_render = True
    collision_source.hide_set(True)
    label = add_empty(
        f"{root_name}_LABEL_ANCHOR",
        parent=root,
        loc=(0.0, -radius * 0.8, radius + 1.0),
        display="CIRCLE",
        size=0.32,
    )
    label["labelAnchor"] = True
    focus = add_empty(
        f"{root_name}_FOCUS_ANCHOR",
        parent=root,
        loc=(0.0, 0.0, 0.0),
        display="PLAIN_AXES",
        size=0.45,
    )
    focus["cameraFocusAnchor"] = True
    return root, lod0, lod1, lod2


def build_reactor_star(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]):
    root, hi, mid, low = asset_root(
        "ReactorSun_ROOT",
        parent=parent,
        loc=(0.0, 0.0, 0.0),
        asset_id="star",
        service="e Gain Reactor Sun",
        radius=5.8,
        signature="Layered reactor iris expands into seven industrial orbit feeds",
    )
    root["code"] = "E GAIN"

    core_action = add_empty("ReactorSun_SIGNATURE_ACTION", parent=hi)
    core_action["signatureAction"] = True
    add_ico("ReactorSun_Nucleus", 2.2, (0, 0, 0), mats["gunmetal"], parent=core_action, subdivisions=4, smooth=True)
    add_ico("ReactorSun_InnerEnergy", 1.12, (0, 0, 0), mats["orange_dim"], parent=core_action, subdivisions=3, smooth=True)
    # The optical cage is translucent rather than a solid black shell: the
    # reactor must read as layered machinery with an energy source inside.
    add_ico("ReactorSun_Cage", 3.05, (0, 0, 0), mats["glass"], parent=hi, subdivisions=3, smooth=False)
    add_structural_cage("ReactorSun", hi, 1.48, 3.05, mats, ring_minor=0.19, strut_count=12)
    add_segmented_armour_shell(
        "ReactorSun",
        hi,
        2.94,
        mats,
        bands=3,
        segments=12,
        thickness=0.22,
        skip={(0, 1), (0, 7), (1, 3), (1, 9), (2, 5), (2, 11)},
        fastener_stride=4,
    )
    for ring_index, (major, minor, rotation) in enumerate(
        (
            (3.22, 0.13, (0, 0, 0)),
            (3.48, 0.09, (math.pi / 2, 0, 0)),
            (3.72, 0.075, (0, math.pi / 2, 0)),
            (4.15, 0.055, (math.pi / 3, math.pi / 5, 0)),
        )
    ):
        add_torus(f"ReactorSun_EnergyRing_{ring_index:02d}", major, minor, (0, 0, 0), mats["orange" if ring_index < 2 else "steel"], parent=hi, rotation=rotation)

    fins = add_empty("ReactorSun_RadiatorFins", parent=hi)
    for i in range(36):
        n = radial_vector(i, 36, latitude=0.0)
        tang = math.atan2(n.y, n.x)
        length = 1.1 + 0.32 * (i % 3)
        plate = add_box(
            f"ReactorSun_Radiator_{i:02d}",
            (0.25, length, 1.05 if i % 2 else 1.45),
            n * (3.55 + length * 0.45),
            mats["gunmetal" if i % 3 else "warm"],
            parent=fins,
            rotation=(0.0, 0.0, tang + math.pi / 2),
            bevel=0.045,
        )
        plate["hardSurfacePart"] = "radiator"
        if i % 3 == 0:
            add_box(
                f"ReactorSun_RadiatorSignal_{i:02d}",
                (0.09, length * 0.86, 0.08),
                n * (3.55 + length * 0.45) + Vector((0, 0, 0.58)),
                mats["orange"],
                parent=fins,
                rotation=(0.0, 0.0, tang + math.pi / 2),
                bevel=0.015,
            )
    for lat_index, latitude in enumerate((-0.62, 0.62)):
        for i in range(12):
            n = radial_vector(i, 12, latitude=latitude, offset=lat_index * 0.11)
            add_panel_on_sphere(
                f"ReactorSun_CollarPlate_{lat_index}_{i:02d}",
                n,
                3.28,
                (0.75, 0.58, 0.12),
                mats["steel" if i % 2 else "graphite"],
                parent=hi,
            )
            add_bolt_on_sphere(f"ReactorSun_Fastener_{lat_index}_{i:02d}", n, 3.39, mats["orange_dim"], parent=hi)
    for i in range(7):
        theta = math.tau * i / 7 + 0.18
        n = Vector((math.cos(theta), math.sin(theta), 0))
        add_cylinder_between(
            f"ReactorSun_OrbitFeed_{i:02d}",
            n * 3.9,
            n * 6.25,
            0.13,
            mats["orange"],
            parent=hi,
            vertices=12,
        )
        add_box(
            f"ReactorSun_FeedLock_{i:02d}",
            (0.45, 0.45, 0.7),
            n * 5.72,
            mats["steel"],
            parent=hi,
            rotation=(0, 0, theta),
        )

    keyframe_cycle(
        core_action,
        peak_scale=(1.17, 1.17, 1.17),
        peak_rotation=(0.0, 0.0, math.pi / 4),
        action_name="SIGNATURE_REACTOR_SUN_7S",
    )

    add_ico("ReactorSun_MID_Core", 1.72, (0, 0, 0), mats["gunmetal"], parent=mid, subdivisions=2, smooth=True)
    add_ico("ReactorSun_MID_Energy", 0.62, (0, 0, 0), mats["orange_dim"], parent=mid, subdivisions=2, smooth=True)
    add_structural_cage("ReactorSun_MID", mid, 1.22, 2.75, mats, ring_minor=0.17, strut_count=7, ring_count=2)
    add_segmented_armour_shell(
        "ReactorSun_MID",
        mid,
        2.82,
        mats,
        bands=3,
        segments=8,
        thickness=0.2,
        skip={(0, 2), (1, 5), (2, 0)},
        fastener_stride=4,
        tile_theta_segments=3,
        tile_phi_segments=3,
    )
    for i, rotation in enumerate(((0, 0, 0), (math.pi / 2, 0, 0), (0, math.pi / 2, 0))):
        add_torus(f"ReactorSun_MID_Ring_{i}", 3.45 + i * 0.2, 0.12, (0, 0, 0), mats["steel" if i else "orange"], parent=mid, rotation=rotation, major_segments=32, minor_segments=6)
    for i in range(18):
        n = radial_vector(i, 18)
        theta = math.atan2(n.y, n.x)
        add_box(f"ReactorSun_MID_Fin_{i:02d}", (0.28, 1.25, 1.15), n * 4.0, mats["graphite"], parent=mid, rotation=(0, 0, theta + math.pi / 2), bevel=0.04)
    add_ico("ReactorSun_LOW_Silhouette", 3.55, (0, 0, 0), mats["orange_dim"], parent=low, subdivisions=2, smooth=True)
    add_torus("ReactorSun_LOW_Ring", 4.0, 0.18, (0, 0, 0), mats["steel"], parent=low, major_segments=24, minor_segments=5)
    return root


def add_planet_panel_bands(prefix: str, parent: bpy.types.Object, radius: float, mats, *, count: int = 24) -> None:
    for i in range(count):
        lat = -0.78 + (i % 4) * 0.52
        n = radial_vector(i, count, latitude=lat, offset=(i % 5) * 0.08)
        add_panel_on_sphere(
            f"{prefix}_ArmourPanel_{i:02d}",
            n,
            radius,
            (0.72 + 0.1 * (i % 3), 0.5 + 0.08 * (i % 2), 0.10),
            mats["graphite" if i % 4 else "steel"],
            parent=parent,
            twist=0.08 * (i % 4),
        )
        if i % 2 == 0:
            add_bolt_on_sphere(f"{prefix}_Fastener_{i:02d}", n, radius + 0.12, mats["orange_dim"], parent=parent, size=0.065)


def build_transform(meta, parent, mats):
    pos = planet_position(meta)
    root, hi, mid, low = asset_root(
        "Planet_transform_ROOT", parent=parent, loc=pos, asset_id="transform", service=meta["service"], radius=meta["radius"], signature=meta["signature"]
    )
    root["code"] = meta["code"]
    shell_action = add_empty("Transform_SIGNATURE_ACTION", parent=hi)
    legacy = add_empty("Transform_LegacyHemisphere", parent=shell_action)
    future = add_empty("Transform_ModularHemisphere", parent=shell_action)
    add_spherical_patch("Transform_LegacyShell", 3.78, math.pi / 2, 3 * math.pi / 2, mats["gunmetal"], parent=legacy, thickness=0.22)
    add_spherical_patch("Transform_FutureShell", 3.64, -math.pi / 2, math.pi / 2, mats["warm"], parent=future, thickness=0.16)
    add_structural_cage("Transform_Inner", hi, 1.72, 3.42, mats, ring_minor=0.18, strut_count=10)
    add_segmented_armour_shell(
        "Transform_Legacy",
        legacy,
        3.9,
        mats,
        bands=4,
        segments=6,
        theta_start=math.pi / 2,
        theta_end=3 * math.pi / 2,
        thickness=0.22,
        material_cycle=("carbon", "forge_oxide", "titanium"),
        skip={(0, 1), (2, 4)},
        fastener_stride=3,
    )
    add_segmented_armour_shell(
        "Transform_Future",
        future,
        3.82,
        mats,
        bands=4,
        segments=6,
        theta_start=-math.pi / 2,
        theta_end=math.pi / 2,
        thickness=0.18,
        material_cycle=("titanium", "ceramic", "nickel"),
        skip={(1, 2), (3, 4)},
        fastener_stride=3,
    )
    for i in range(28):
        theta = math.pi / 2 + math.pi * (i / 27)
        phi = 0.24 + math.pi * ((i * 7) % 27) / 27
        n = Vector((math.sin(phi) * math.cos(theta), math.sin(phi) * math.sin(theta), math.cos(phi)))
        add_panel_on_sphere(f"Transform_LegacyPlate_{i:02d}", n, 3.9, (0.85, 0.55, 0.13), mats["graphite" if i % 3 else "steel"], parent=legacy, twist=0.12 * i)
        if i % 3 == 0:
            add_bolt_on_sphere(f"Transform_LegacyBolt_{i:02d}", n, 4.04, mats["warm"], parent=legacy)
    for i in range(32):
        theta = -math.pi / 2 + math.pi * (i / 31)
        phi = 0.18 + math.pi * ((i * 11) % 31) / 31
        n = Vector((math.sin(phi) * math.cos(theta), math.sin(phi) * math.sin(theta), math.cos(phi)))
        size = 0.52 + 0.13 * (i % 3)
        add_panel_on_sphere(f"Transform_FutureModule_{i:02d}", n, 3.85, (size, size * 0.78, 0.22 + 0.05 * (i % 2)), mats["warm_bright" if i % 5 == 0 else "steel"], parent=future, twist=0.09 * i)
    # Hero-facing secondary armour: staggered plates, recessed interfaces and
    # fasteners make both hemispheres hold up in the close web camera.
    for side_index, (sign, assembly) in enumerate(((-1, legacy), (1, future))):
        for row, z in enumerate((-2.15, -1.05, 0.05, 1.15, 2.25)):
            for column, x_abs in enumerate((0.88, 2.02)):
                x = sign * x_abs
                y = -math.sqrt(max(0.8, 3.72**2 - x**2 - z**2))
                normal = Vector((x, y, z)).normalized()
                panel_mat = mats["carbon" if side_index == 0 and (row + column) % 2 else "titanium"]
                add_panel_on_sphere(
                    f"Transform_HeroPanel_{side_index}_{row}_{column}",
                    normal,
                    3.82,
                    (0.92, 0.72, 0.13 + 0.035 * ((row + column) % 2)),
                    panel_mat,
                    parent=assembly,
                    twist=0.08 * (row - column),
                )
                add_bolt_on_sphere(
                    f"Transform_HeroFastener_{side_index}_{row}_{column}",
                    normal,
                    3.98,
                    mats["warm" if side_index == 0 else "orange_dim"],
                    parent=assembly,
                    size=0.075,
                )
        for port_index, z in enumerate((-1.65, 0.0, 1.65)):
            x = sign * 2.78
            y = -math.sqrt(max(0.8, 3.62**2 - x**2 - z**2))
            add_cylinder(
                f"Transform_InterfacePort_{side_index}_{port_index}",
                0.22,
                0.28,
                (x, y - 0.12, z),
                mats["orange_dim" if side_index else "warm"],
                parent=assembly,
                rotation=(math.pi / 2, 0, 0),
                vertices=16,
                bevel=0.025,
            )
    for rail_index, x in enumerate((-0.42, 0.42)):
        add_box(
            f"Transform_ConversionSlideRail_{rail_index}",
            (0.17, 0.26, 5.7),
            (x, -3.5, 0),
            mats["steel"],
            parent=hi,
            bevel=0.035,
        )
        for lock_index, z in enumerate((-2.25, -0.75, 0.75, 2.25)):
            add_box(
                f"Transform_RailLock_{rail_index}_{lock_index}",
                (0.42, 0.22, 0.24),
                (x, -3.7, z),
                mats["orange_dim"],
                parent=hi,
                bevel=0.035,
            )
    for bridge_index, z in enumerate((-2.35, -1.18, 0.0, 1.18, 2.35)):
        add_bearing_stack(
            f"Transform_ConversionBridge_{bridge_index}",
            (0, -3.82, z),
            Vector((0, -1, 0)),
            mats,
            parent=hi,
            radius=0.2 if bridge_index != 2 else 0.28,
            depth=0.42,
            signal=bridge_index == 2,
        )
        add_box(
            f"Transform_ConversionCrossMember_{bridge_index}",
            (1.1, 0.18, 0.12),
            (0, -3.65, z),
            mats["nickel"],
            parent=hi,
            bevel=0.028,
        )
    for panel_index, (x, z) in enumerate(((-2.2, -1.2), (-2.25, 1.25), (2.2, -1.2), (2.25, 1.25))):
        normal = Vector((x, -math.sqrt(max(0.5, 3.55**2 - x**2 - z**2)), z)).normalized()
        add_recessed_service_panel(
            f"Transform_HeroService_{panel_index}",
            normal,
            3.7,
            0.78,
            0.58,
            mats,
            parent=legacy if x < 0 else future,
            housing_mat="carbon" if x < 0 else "ceramic_dark",
            face_mat="forge_oxide" if x < 0 else "ceramic",
            signal=panel_index == 3,
            twist=0.1 * (panel_index - 1),
        )
    # The conversion fault is a load-bearing transfer trench, not a painted
    # orange crack.  A recessed serrated throat, paired datum rails and
    # alternating transfer carriages explain how legacy mass is indexed into
    # the future modules.  Only three encoder keys carry signal orange.
    fault = add_empty("Transform_ConversionFault", parent=hi)
    rift_profile = (
        (-0.52, -3.12), (-0.28, -3.48), (0.08, -3.28), (0.42, -3.5),
        (0.55, -2.38), (0.36, -1.64), (0.52, -0.82), (0.34, 0.0),
        (0.54, 0.82), (0.34, 1.62), (0.5, 2.42), (0.24, 3.46),
        (-0.16, 3.26), (-0.48, 3.48), (-0.56, 2.3), (-0.38, 1.54),
        (-0.54, 0.76), (-0.36, -0.08), (-0.52, -0.9), (-0.34, -1.72),
    )
    add_extruded_profile(
        "Transform_ConversionRiftBack",
        rift_profile,
        0.5,
        (0, -3.17, 0),
        mats["carbon"],
        parent=fault,
        bevel=0.055,
    )
    for i in range(15):
        z = -3.35 + i * 0.48
        signal_segment = i in (3, 7, 11)
        add_box(
            f"Transform_FaultSegment_{i:02d}",
            (0.16 + 0.055 * (i % 2), 0.16, 0.28),
            ((-0.07 if i % 2 else 0.07), -3.72, z),
            mats["orange_dim" if signal_segment else ("nickel" if i % 2 else "titanium")],
            parent=fault,
            rotation=(0, 0, 0.1 * ((i % 3) - 1)),
            bevel=0.022,
        )

    # Six indexed conversion stations span the split.  Their angled load
    # struts disappear into each hemisphere instead of floating on the skin.
    for station, z in enumerate((-2.55, -1.55, -0.52, 0.52, 1.55, 2.55)):
        side = -1 if station % 2 == 0 else 1
        carriage = add_box(
            f"Transform_TransferCarriage_{station:02d}",
            (0.96, 0.52, 0.42),
            (0, -3.82, z),
            mats["carbon"],
            parent=fault,
            bevel=0.065,
        )
        carriage["conversionStation"] = station
        add_box(
            f"Transform_TransferDatum_{station:02d}",
            (0.52, 0.12, 0.19),
            (0, -4.1, z),
            mats["orange_dim" if station == 3 else "ceramic"],
            parent=fault,
            bevel=0.024,
        )
        add_bearing_stack(
            f"Transform_TransferBearing_{station:02d}",
            (side * 0.49, -3.86, z),
            Vector((1, 0, 0)),
            mats,
            parent=fault,
            radius=0.15,
            depth=0.34,
            signal=station == 3,
        )
        add_cylinder_between(
            f"Transform_LegacyLoadStrut_{station:02d}",
            Vector((-0.48, -3.54, z)),
            Vector((-2.42, -2.72, z + (0.32 if station % 2 else -0.28))),
            0.105,
            mats["forge_oxide" if station % 2 else "titanium"],
            parent=fault,
            vertices=12,
        )
        add_cylinder_between(
            f"Transform_FutureLoadStrut_{station:02d}",
            Vector((0.48, -3.54, z)),
            Vector((2.42, -2.72, z + (-0.28 if station % 2 else 0.32))),
            0.105,
            mats["nickel" if station % 2 else "titanium"],
            parent=fault,
            vertices=12,
        )

    # Surface language is deliberately different on both sides: the legacy
    # side has repair buttresses and exhaust louvers; the future side has a
    # clean modular datum lattice and keyed interface cassettes.
    for rib_index, z in enumerate((-2.15, -0.75, 0.72, 2.12)):
        add_cylinder_between(
            f"Transform_LegacyRepairButtress_{rib_index:02d}",
            Vector((-0.82, -3.38, z)),
            Vector((-3.05, -1.98, z + (0.42 if rib_index % 2 else -0.38))),
            0.14,
            mats["forge_oxide" if rib_index % 2 else "carbon"],
            parent=legacy,
            vertices=14,
        )
        for louver in range(4):
            add_box(
                f"Transform_LegacyVent_{rib_index:02d}_{louver:02d}",
                (0.52, 0.09, 0.055),
                (-2.55, -3.0, z - 0.18 + louver * 0.12),
                mats["nickel"],
                parent=legacy,
                rotation=(0, 0, -0.08),
                bevel=0.012,
            )
    for datum_index, z in enumerate((-2.1, -0.7, 0.7, 2.1)):
        add_box(
            f"Transform_FutureDatumRail_{datum_index:02d}",
            (2.25, 0.14, 0.15),
            (2.05, -3.12, z),
            mats["titanium"],
            parent=future,
            bevel=0.03,
        )
        for node_index, x in enumerate((1.12, 2.02, 2.92)):
            add_box(
                f"Transform_FutureDatumNode_{datum_index:02d}_{node_index:02d}",
                (0.34, 0.22, 0.34),
                (x, -3.24, z),
                mats["ceramic" if node_index == 1 else "nickel"],
                parent=future,
                bevel=0.045,
            )
    add_torus("Transform_EquatorialConversionRing", 4.03, 0.095, (0, 0, 0), mats["steel"], parent=hi, rotation=(0, 0, 0), major_segments=56)
    keyframe_cycle(legacy, peak_location=(-0.68, 0.0, 0.0), peak_rotation=(0.0, -0.12, -0.16), action_name="SIGNATURE_TRANSFORM_LEGACY_7S")
    keyframe_cycle(future, peak_location=(0.62, 0.0, 0.0), peak_rotation=(0.0, 0.14, 0.18), action_name="SIGNATURE_TRANSFORM_FUTURE_7S")

    add_ico("Transform_MID_Core", 2.18, (0, 0, 0), mats["gunmetal"], parent=mid, subdivisions=2)
    add_structural_cage("Transform_MID", mid, 1.45, 3.35, mats, ring_minor=0.17, strut_count=7, ring_count=2)
    add_spherical_patch("Transform_MID_Legacy", 3.72, math.pi / 2, 3 * math.pi / 2, mats["gunmetal"], parent=mid, theta_segments=12, phi_segments=10, thickness=0.16)
    add_spherical_patch("Transform_MID_Future", 3.62, -math.pi / 2, math.pi / 2, mats["warm"], parent=mid, theta_segments=12, phi_segments=10, thickness=0.12)
    add_segmented_armour_shell(
        "Transform_MID_Legacy",
        mid,
        3.76,
        mats,
        bands=3,
        segments=4,
        theta_start=math.pi / 2,
        theta_end=3 * math.pi / 2,
        thickness=0.18,
        material_cycle=("carbon", "titanium"),
        skip={(1, 2)},
        fastener_stride=3,
        tile_theta_segments=3,
        tile_phi_segments=3,
    )
    add_segmented_armour_shell(
        "Transform_MID_Future",
        mid,
        3.7,
        mats,
        bands=3,
        segments=4,
        theta_start=-math.pi / 2,
        theta_end=math.pi / 2,
        thickness=0.16,
        material_cycle=("titanium", "ceramic"),
        skip={(1, 1)},
        fastener_stride=3,
        tile_theta_segments=3,
        tile_phi_segments=3,
    )
    add_torus("Transform_MID_Fault", 3.92, 0.14, (0, 0, 0), mats["orange"], parent=mid, rotation=(0, math.pi / 2, 0), major_segments=28, minor_segments=6)
    for rail, x in enumerate((-0.4, 0.4)):
        add_box(f"Transform_MID_SlideRail_{rail}", (0.2, 0.28, 5.25), (x, -3.48, 0), mats["steel"], parent=mid, bevel=0.045)
        for lock, z in enumerate((-1.8, 0, 1.8)):
            add_box(f"Transform_MID_RailLock_{rail}_{lock}", (0.45, 0.28, 0.3), (x, -3.65, z), mats["orange_dim"], parent=mid, bevel=0.04)
    for bridge_index, z in enumerate((-1.75, 0, 1.75)):
        add_bearing_stack(
            f"Transform_MID_ConversionBridge_{bridge_index}",
            (0, -3.68, z),
            Vector((0, -1, 0)),
            mats,
            parent=mid,
            radius=0.2,
            depth=0.38,
            signal=bridge_index == 1,
        )
    # Balanced repeats the same transfer-trench silhouette and load paths;
    # only the fine louvers and secondary fasteners are removed.
    mid_rift_profile = tuple((x * 0.9, z * 0.92) for x, z in rift_profile)
    add_extruded_profile(
        "Transform_MID_ConversionRiftBack",
        mid_rift_profile,
        0.42,
        (0, -3.12, 0),
        mats["carbon"],
        parent=mid,
        bevel=0.05,
    )
    for station, z in enumerate((-2.35, -1.18, 0, 1.18, 2.35)):
        add_box(
            f"Transform_MID_TransferCarriage_{station:02d}",
            (0.88, 0.46, 0.38),
            (0, -3.72, z),
            mats["carbon"],
            parent=mid,
            bevel=0.055,
        )
        for side, x_end in ((-1, -2.28), (1, 2.28)):
            add_cylinder_between(
                f"Transform_MID_LoadStrut_{station:02d}_{'L' if side < 0 else 'R'}",
                Vector((side * 0.44, -3.46, z)),
                Vector((x_end, -2.62, z + side * (0.25 if station % 2 else -0.25))),
                0.105,
                mats["titanium" if side > 0 else "forge_oxide"],
                parent=mid,
                vertices=10,
            )
    add_box("Transform_MID_EncoderKey", (0.1, 0.09, 0.74), (0, -3.98, 0), mats["orange_dim"], parent=mid, bevel=0.015)
    add_ico("Transform_LOW_Legacy", 3.5, (-0.22, 0, 0), mats["graphite"], parent=low, subdivisions=2)
    add_ico("Transform_LOW_Future", 3.4, (0.22, 0, 0), mats["warm"], parent=low, subdivisions=2)
    return root


def build_build(meta, parent, mats):
    root, hi, mid, low = asset_root(
        "Planet_build_ROOT", parent=parent, loc=planet_position(meta), asset_id="build",
        service=meta["service"], radius=meta["radius"], signature=meta["signature"]
    )
    root["code"] = meta["code"]

    def frame_points(width: float, height: float, y: float) -> tuple[Vector, ...]:
        """A bevelled rectangular forge section, deliberately not a ring."""
        return (
            Vector((-width * 0.34, y, -height * 0.5)),
            Vector((width * 0.34, y, -height * 0.5)),
            Vector((width * 0.5, y, -height * 0.31)),
            Vector((width * 0.5, y, height * 0.31)),
            Vector((width * 0.34, y, height * 0.5)),
            Vector((-width * 0.34, y, height * 0.5)),
            Vector((-width * 0.5, y, height * 0.31)),
            Vector((-width * 0.5, y, -height * 0.31)),
        )

    def add_forge_frame(
        name: str,
        width: float,
        height: float,
        y: float,
        radius: float,
        mat: bpy.types.Material,
        frame_parent: bpy.types.Object,
        child_prefix: str,
    ) -> tuple[bpy.types.Object, tuple[Vector, ...]]:
        collar = add_empty(name, parent=frame_parent)
        points = frame_points(width, height, y)
        for edge_index, start in enumerate(points):
            add_cylinder_between(
                f"{child_prefix}_{edge_index:02d}", start, points[(edge_index + 1) % len(points)],
                radius, mat if edge_index not in (2, 6) else mats["nickel"],
                parent=collar, vertices=8
            )
        return collar, points

    # BUILD is an asymmetric orbital foundry-city arranged in three genuine
    # depth planes.  A narrow rear backbone carries the load without becoming
    # another large flat planetary plate.
    rear_spine_profile = (
        (-1.18, -2.3), (-0.78, -2.68), (0.42, -2.62), (1.02, -2.12),
        (0.86, -0.55), (1.32, 0.18), (1.08, 2.18), (0.36, 2.72),
        (-0.62, 2.56), (-1.28, 1.72), (-1.08, 0.42), (-1.46, -0.36),
    )
    add_extruded_profile(
        "Build_FoundryCore", rear_spine_profile, 1.32, (0.18, 1.22, 0.02),
        mats["forge_oxide"], parent=hi, bevel=0.13
    )
    add_box("Build_RearLoadSpine", (0.52, 1.5, 5.32), (-0.42, 1.1, 0.08), mats["carbon"], parent=hi, rotation=(0, 0, -0.08), bevel=0.085)
    add_box("Build_RearLoadSpineCap", (0.84, 1.66, 0.36), (-0.5, 1.05, 2.55), mats["titanium"], parent=hi, rotation=(0, 0, -0.08), bevel=0.055)

    towers = add_empty("Build_SIGNATURE_ACTION", parent=hi)
    district_specs = (
        (
            "NORTH", (-0.68, 0.94, 2.22), 1.46, "titanium",
            ((-1.05, -0.72), (-0.76, -1.12), (0.28, -1.1), (0.9, -0.68), (0.84, 0.5), (0.34, 1.3), (-0.38, 1.48), (-1.02, 0.72)),
        ),
        (
            "WEST", (-2.58, 0.08, 0.58), 1.76, "carbon",
            ((-1.25, -0.72), (-0.98, -1.03), (0.76, -1.0), (1.12, -0.56), (1.02, 0.32), (0.5, 0.7), (-0.26, 0.66), (-0.7, 1.08), (-1.28, 0.54)),
        ),
        (
            "EAST", (2.38, -0.38, 0.72), 2.08, "forge_oxide",
            ((-0.88, -1.08), (-0.42, -1.34), (0.78, -1.2), (1.16, -0.46), (1.02, 0.88), (0.42, 1.26), (-0.22, 0.98), (-0.78, 1.42), (-1.1, 0.48)),
        ),
        (
            "SOUTH_WEST", (-2.0, -0.82, -1.72), 1.54, "gunmetal",
            ((-1.34, -0.58), (-0.88, -1.0), (0.52, -0.96), (1.18, -0.52), (1.22, 0.36), (0.62, 0.78), (-0.46, 0.68), (-1.2, 0.28)),
        ),
        (
            "SOUTH_EAST", (1.62, -1.22, -1.82), 2.42, "titanium",
            ((-1.12, -0.9), (-0.48, -1.25), (0.66, -1.08), (1.3, -0.46), (1.16, 0.42), (0.46, 0.84), (-0.18, 0.66), (-0.76, 1.02), (-1.28, 0.3)),
        ),
    )
    district_fronts: dict[str, float] = {}
    for district_index, (district_id, loc, depth, district_mat, profile) in enumerate(district_specs):
        centre = Vector(loc)
        district_fronts[district_id] = centre.y - depth * 0.5
        block = add_extruded_profile(
            f"Build_FoundryDistrict_{district_id}", profile, depth, loc,
            mats[district_mat], parent=towers, bevel=0.115
        )
        block["assemblySequence"] = district_index
        block["depthPlane"] = "rear" if centre.y > 0.5 else ("front" if centre.y < -0.55 else "middle")
        face_profile = tuple((x * 0.82, z * 0.8) for x, z in profile)
        add_extruded_profile(
            f"Build_FoundryDistrictFace_{district_id}", face_profile, 0.18,
            (centre.x, district_fronts[district_id] - 0.105, centre.z),
            mats["ceramic_dark" if district_index in (1, 3) else "nickel"],
            parent=towers, bevel=0.05
        )

        # Paired load paths terminate at visibly different chassis nodes, so
        # each mass reads as supported architecture rather than a radial petal.
        inner_x = centre.x - math.copysign(min(abs(centre.x) * 0.42, 0.92), centre.x)
        inner_z = centre.z - math.copysign(min(abs(centre.z) * 0.34, 0.72), centre.z)
        add_cylinder_between(
            f"Build_DistrictLoadRib_{district_id}_A",
            Vector((math.copysign(0.72, centre.x), 0.62, math.copysign(0.5, centre.z))),
            Vector((inner_x, centre.y - 0.08, inner_z)),
            0.145, mats["titanium"], parent=towers, vertices=12
        )
        add_cylinder_between(
            f"Build_DistrictLoadRib_{district_id}_B",
            Vector((math.copysign(0.5, centre.x), 0.92, centre.z * 0.32)),
            Vector((centre.x * 0.9, centre.y + 0.2, centre.z * 0.82)),
            0.1, mats["nickel"], parent=towers, vertices=10
        )

    # Each district has its own mechanically credible purpose instead of a
    # repeated surface kit: exhaust tower, intake bank, interface stack, lock
    # sled and assembly bay respectively.
    north_front = district_fronts["NORTH"] - 0.11
    for vent_index, x in enumerate((-1.2, -0.92, -0.64, -0.36)):
        add_box(
            f"Build_NorthHeatExchanger_{vent_index}", (0.13, 0.16, 1.02 + vent_index * 0.08),
            (x, north_front, 2.3 + vent_index * 0.06), mats["carbon"], parent=towers,
            rotation=(0, 0, -0.04), bevel=0.024
        )
    add_bearing_stack("Build_NorthLiftBearing", (-0.08, north_front - 0.03, 2.38), Vector((0, -1, 0)), mats, parent=towers, radius=0.28, depth=0.34)

    west_front = district_fronts["WEST"] - 0.11
    add_box("Build_WestServiceDoor", (1.28, 0.15, 0.82), (-2.5, west_front, 0.55), mats["ceramic_dark"], parent=towers, bevel=0.055)
    for vent_index, z in enumerate((0.24, 0.48, 0.72, 0.96)):
        add_box(f"Build_WestIntakeVent_{vent_index}", (0.84, 0.09, 0.075), (-2.48, west_front - 0.09, z), mats["graphite"], parent=towers, bevel=0.012)
    for fastener_index, (x, z) in enumerate(((-3.02, 0.18), (-1.98, 0.18), (-3.02, 0.92), (-1.98, 0.92))):
        add_cylinder(f"Build_WestDoorFastener_{fastener_index}", 0.075, 0.16, (x, west_front - 0.14, z), mats["warm"], parent=towers, rotation=(math.pi / 2, 0, 0), vertices=10, bevel=0.012)

    east_front = district_fronts["EAST"] - 0.11
    add_box("Build_EastInterfaceHousing", (1.12, 0.2, 1.42), (2.42, east_front, 0.68), mats["carbon"], parent=towers, bevel=0.07)
    for port_index, z in enumerate((0.25, 0.82, 1.18)):
        add_bearing_stack(
            f"Build_EastInterfacePort_{port_index}", (2.4 + 0.18 * (port_index % 2), east_front - 0.16, z),
            Vector((0, -1, 0)), mats, parent=towers, radius=0.19 if port_index != 1 else 0.24,
            depth=0.34, signal=port_index == 1
        )

    south_west_front = district_fronts["SOUTH_WEST"] - 0.1
    add_box("Build_SouthWestLockRail", (1.72, 0.18, 0.22), (-2.0, south_west_front, -1.72), mats["nickel"], parent=towers, bevel=0.04)
    for lock_index, x in enumerate((-2.62, -2.0, -1.38)):
        add_box(f"Build_SouthWestLockLatch_{lock_index}", (0.26, 0.28, 0.54), (x, south_west_front - 0.12, -1.72), mats["carbon"], parent=towers, bevel=0.045)
        add_cylinder(f"Build_SouthWestLockPin_{lock_index}", 0.075, 0.34, (x, south_west_front - 0.29, -1.72), mats["warm"], parent=towers, rotation=(math.pi / 2, 0, 0), vertices=10, bevel=0.012)

    south_east_front = district_fronts["SOUTH_EAST"] - 0.11
    for bay_index, z in enumerate((-2.32, -1.82, -1.3)):
        add_box(f"Build_SouthEastAssemblyBay_{bay_index}", (1.22 - bay_index * 0.1, 0.18, 0.34), (1.72, south_east_front, z), mats["ceramic_dark"], parent=towers, bevel=0.045)
        add_box(f"Build_SouthEastBayLock_{bay_index}", (0.18, 0.12, 0.16), (2.18, south_east_front - 0.12, z), mats["orange_dim" if bay_index == 1 else "nickel"], parent=towers, bevel=0.018)

    # The hero centre is now a deep rectilinear forge tunnel.  Four shrinking
    # octagonal structural collars and longitudinal rails expose real depth;
    # there is no circular hub/button silhouette.
    foundry_face = add_empty("Build_HeroFoundryFace", parent=towers)
    collar_specs = (
        (-3.2, 3.36, 2.92, 0.17, "titanium"),
        (-2.45, 2.96, 2.52, 0.145, "carbon"),
        (-1.72, 2.5, 2.12, 0.125, "titanium"),
        (-1.04, 2.08, 1.72, 0.105, "carbon"),
    )
    collar_points: list[tuple[Vector, ...]] = []
    for collar_index, (y, width, height, beam_radius, material) in enumerate(collar_specs):
        _, points = add_forge_frame(
            f"Build_ForgeTunnelCollar_{collar_index}", width, height, y, beam_radius,
            mats[material], foundry_face, f"Build_ForgeTunnelFrameBeam_{collar_index}"
        )
        collar_points.append(points)
    mouth_points = frame_points(3.72, 3.22, -3.5)
    for sector, start in enumerate(mouth_points):
        add_cylinder_between(
            f"Build_ForgeMouthSector_{sector:02d}", start, mouth_points[(sector + 1) % 8],
            0.205, mats["forge_oxide" if sector in (1, 6) else "carbon"],
            parent=foundry_face, vertices=8
        )
    for rail_index in (0, 2, 4, 6):
        for stage in range(len(collar_points) - 1):
            add_cylinder_between(
                f"Build_ForgeTunnelRail_{rail_index}_{stage}", collar_points[stage][rail_index], collar_points[stage + 1][rail_index],
                0.075, mats["nickel" if rail_index in (0, 4) else "gunmetal"], parent=foundry_face, vertices=8
            )
    die_profile = ((-0.72, -0.42), (-0.42, -0.72), (0.48, -0.72), (0.76, -0.32), (0.7, 0.48), (0.28, 0.72), (-0.52, 0.64), (-0.78, 0.24))
    add_extruded_profile("Build_ForgeDieBack", die_profile, 0.38, (0.08, -0.56, 0), mats["ceramic_dark"], parent=foundry_face, bevel=0.075)
    add_box("Build_ForgeDieClampLeft", (0.2, 0.18, 0.92), (-0.43, -0.82, 0), mats["titanium"], parent=foundry_face, bevel=0.035)
    add_box("Build_ForgeDieClampRight", (0.2, 0.18, 0.92), (0.53, -0.82, 0), mats["titanium"], parent=foundry_face, bevel=0.035)
    add_box("Build_ForgeCausalSeam", (0.075, 0.105, 0.68), (0.05, -0.94, 0), mats["orange_dim"], parent=foundry_face, bevel=0.012)

    # Four non-radial gantries transfer district loads across the layered city.
    gantry_specs = (
        ((-3.18, -0.62, 0.2), (-1.38, -1.36, 1.12), 1.0),
        ((3.16, -0.18, 0.88), (1.36, -1.55, 1.62), -1.0),
        ((-1.82, 0.5, 3.05), (-0.46, -0.62, 2.14), 1.0),
        ((2.42, -0.95, -2.72), (0.86, -1.74, -1.92), -1.0),
    )
    for gantry_index, (mast_loc, bridge_end, side) in enumerate(gantry_specs):
        x, y, z = mast_loc
        gantry = add_empty(f"Build_Gantry_{gantry_index}_ACTION", parent=towers)
        add_box(f"Build_GantryMast_{gantry_index}", (0.38, 0.62, 1.92), mast_loc, mats["carbon"], parent=gantry, bevel=0.065)
        bridge_start = Vector((x, y - 0.2, z + 0.72))
        add_cylinder_between(f"Build_GantryBridge_{gantry_index}", bridge_start, Vector(bridge_end), 0.15, mats["titanium"], parent=gantry, vertices=10)
        add_cylinder_between(
            f"Build_GantryTensionRib_{gantry_index}", Vector((x, y + 0.18, z - 0.7)), Vector(bridge_end),
            0.105, mats["nickel"], parent=gantry, vertices=10
        )
        hoist = (Vector(bridge_end) * 0.72) + (bridge_start * 0.28) + Vector((0, -0.14, -0.08 * side))
        add_bearing_stack(
            f"Build_GantryHoist_{gantry_index}", hoist, Vector((0, -1, 0)), mats,
            parent=gantry, radius=0.22, depth=0.38, signal=gantry_index == 1
        )
    keyframe_cycle(
        towers, peak_location=(0, -0.16, 0.28), peak_rotation=(0, 0, math.radians(2.5)),
        peak_scale=(1.018, 1.0, 1.035), action_name="SIGNATURE_BUILD_ASSEMBLY_7S"
    )

    # Balanced keeps the authored front/middle/rear silhouette, the five
    # distinct district profiles and a true tunnel, while dropping fasteners,
    # service internals and most longitudinal braces.
    add_extruded_profile(
        "Build_MID_Core", tuple((x * 0.94, z * 0.94) for x, z in rear_spine_profile),
        1.16, (0.18, 1.16, 0.02), mats["forge_oxide"], parent=mid, bevel=0.115
    )
    for district_index, (district_id, loc, depth, district_mat, profile) in enumerate(district_specs):
        add_extruded_profile(
            f"Build_MID_District_{district_id}", tuple((x * 0.94, z * 0.94) for x, z in profile),
            depth * 0.88, loc, mats[district_mat], parent=mid, bevel=0.1
        )
        centre = Vector(loc)
        add_cylinder_between(
            f"Build_MID_DistrictRib_{district_id}",
            Vector((math.copysign(0.62, centre.x), 0.68, math.copysign(0.42, centre.z))),
            Vector((centre.x * 0.72, centre.y + 0.08, centre.z * 0.72)),
            0.13, mats["titanium"], parent=mid, vertices=10
        )
    for collar_index, (y, width, height) in enumerate(((-3.12, 3.28, 2.82), (-2.16, 2.68, 2.28), (-1.28, 2.14, 1.78))):
        add_forge_frame(
            f"Build_MID_ForgeTunnel_{collar_index}", width, height, y, 0.14 - collar_index * 0.015,
            mats["titanium" if collar_index != 1 else "carbon"], mid,
            f"Build_MID_ForgeTunnelFrameBeam_{collar_index}"
        )
    add_box("Build_MID_ForgeDieBack", (1.22, 0.32, 1.06), (0.05, -0.62, 0), mats["ceramic_dark"], parent=mid, bevel=0.07)
    add_box("Build_MID_ForgeCausalSeam", (0.065, 0.1, 0.58), (0.05, -0.82, 0), mats["orange_dim"], parent=mid, bevel=0.01)
    for gantry_index, (mast_loc, bridge_end, _side) in enumerate(gantry_specs):
        add_box(f"Build_MID_Gantry_{gantry_index}", (0.42, 0.58, 1.82), mast_loc, mats["carbon"], parent=mid, bevel=0.065)
        add_cylinder_between(
            f"Build_MID_GantryBridge_{gantry_index}", Vector((mast_loc[0], mast_loc[1] - 0.12, mast_loc[2] + 0.64)),
            Vector(bridge_end), 0.14, mats["titanium"], parent=mid, vertices=8
        )
    low_profile = (
        (-3.45, -2.12), (-2.55, -2.88), (-0.72, -2.72), (0.1, -2.18),
        (2.72, -2.62), (3.58, -1.46), (3.42, 1.5), (2.28, 2.12),
        (0.25, 3.42), (-1.58, 3.18), (-2.28, 1.92), (-3.68, 1.08),
    )
    add_extruded_profile("Build_LOW_Silhouette", low_profile, 2.42, (0, 0.12, 0), mats["graphite"], parent=low, bevel=0.16)
    low_mouth = frame_points(3.1, 2.62, -1.44)
    for edge_index, start in enumerate(low_mouth):
        add_cylinder_between(
            f"Build_LOW_ForgeMouth_{edge_index}", start, low_mouth[(edge_index + 1) % 8],
            0.17, mats["titanium"], parent=low, vertices=8
        )
    return root


def _build_experience_legacy(meta, parent, mats):
    root, hi, mid, low = asset_root("Planet_experience_ROOT", parent=parent, loc=planet_position(meta), asset_id="experience", service=meta["service"], radius=meta["radius"], signature=meta["signature"])
    root["code"] = meta["code"]
    # Optical world: no opaque planetary shell.  Two segmented lens frames,
    # structural barrel rails and an exposed iris carry every visible load.
    add_uv_sphere("Experience_OpticalVolume", 2.68, (0, 0, 0), mats["optical_blue"], parent=hi, segments=40, rings=20, scale=(1.18, 0.58, 0.74))
    frame = add_empty("Experience_ThickLensFrame", parent=hi)
    for face_index, y in enumerate((-2.3, 2.05)):
        for sector in range(12):
            start = math.tau * sector / 12 + 0.018
            end = math.tau * (sector + 1) / 12 - 0.018
            add_annular_sector(
                f"Experience_{'Front' if face_index == 0 else 'Rear'}FrameSector_{sector:02d}",
                2.82,
                3.42,
                start,
                end,
                0.44,
                y,
                mats["carbon" if sector % 3 else "titanium"],
                parent=frame,
                scale_x=1.18,
                scale_z=0.78,
                bevel_width=0.06,
            )
    # Segmented glass makes thickness and refraction legible without a black
    # ball behind the aperture.
    for sector in range(10):
        start = math.tau * sector / 10 + 0.025
        end = math.tau * (sector + 1) / 10 - 0.025
        add_annular_sector(
            f"Experience_GlassSegment_{sector:02d}",
            0.42,
            2.68,
            start,
            end,
            0.17,
            -2.58,
            mats["optical_blue" if sector % 2 else "glass"],
            parent=frame,
            scale_x=1.16,
            scale_z=0.76,
            bevel_width=0.025,
        )
    # Barrel rails tie the front and rear frames together.  Every floating
    # interface now has an explicit mechanical load path.
    for rail in range(12):
        theta = math.tau * rail / 12
        x = math.cos(theta) * 3.18 * 1.18
        z = math.sin(theta) * 3.18 * 0.78
        start = Vector((x, -2.08, z))
        end = Vector((x, 1.84, z))
        add_cylinder_between(f"Experience_BarrelRail_{rail:02d}", start, end, 0.12 if rail % 3 else 0.16, mats["steel" if rail % 2 else "gunmetal"], parent=frame, vertices=14)
        add_cylinder(f"Experience_RailHingeFront_{rail:02d}", 0.18, 0.22, start, mats["warm"], parent=frame, rotation=(math.pi / 2, 0, 0), vertices=16, bevel=0.025)
        add_cylinder(f"Experience_RailHingeRear_{rail:02d}", 0.18, 0.22, end, mats["warm"], parent=frame, rotation=(math.pi / 2, 0, 0), vertices=16, bevel=0.025)

    iris = add_empty("Experience_SIGNATURE_ACTION", parent=hi, loc=(0, -2.78, 0))
    for blade_index in range(11):
        pivot = add_empty(f"Experience_IrisPivot_{blade_index:02d}", parent=iris)
        blade = add_iris_leaf(
            f"Experience_IrisBlade_{blade_index:02d}",
            blade_index,
            11,
            0.62,
            2.42,
            0.23,
            0.025 * ((blade_index % 3) - 1),
            mats["warm" if blade_index % 5 == 0 else ("gunmetal" if blade_index % 2 else "steel")],
            parent=pivot,
            scale_x=1.14,
            scale_z=0.75,
            bevel_width=0.045,
        )
        blade["adaptiveAperturePart"] = True
        keyframe_cycle(
            pivot,
            peak_rotation=(0, 0, math.radians(18 + blade_index * 0.65)),
            peak_scale=(0.91, 0.91, 0.91),
            action_name=f"SIGNATURE_EXPERIENCE_IRIS_{blade_index:02d}_7S",
        )
        hinge_theta = math.tau * blade_index / 11 + math.tau / 11 * 0.5
        hinge_pos = Vector((math.cos(hinge_theta) * 2.28 * 1.14, -0.15 - 0.018 * (blade_index % 3), math.sin(hinge_theta) * 2.28 * 0.75))
        add_cylinder(f"Experience_IrisHinge_{blade_index:02d}", 0.15, 0.25, hinge_pos, mats["warm"], parent=pivot, rotation=(math.pi / 2, 0, 0), vertices=14, bevel=0.025)
    add_cylinder("Experience_ApertureHub", 0.4, 0.42, (0, 0.18, 0), mats["graphite"], parent=iris, rotation=(math.pi / 2, 0, 0), vertices=24, bevel=0.055)
    add_torus("Experience_ApertureBearing", 0.66, 0.13, (0, -0.14, 0), mats["steel"], parent=iris, rotation=(math.pi / 2, 0, 0), scale=(1.14, 1, 0.75), major_segments=40, minor_segments=8)
    add_torus("Experience_IrisSignalSeam", 0.58, 0.075, (0, -0.14, 0), mats["orange_dim"], parent=iris, rotation=(math.pi / 2, 0, 0), scale=(1.14, 1, 0.75), major_segments=40, minor_segments=7)
    actuators = add_empty("Experience_ExposedActuators", parent=hi)
    for actuator in range(8):
        theta = math.tau * actuator / 8
        outer = Vector((math.cos(theta) * 3.62 * 1.16, -2.82, math.sin(theta) * 3.62 * 0.76))
        inner_theta = theta + 0.18
        inner = Vector((math.cos(inner_theta) * 2.46 * 1.14, -2.9, math.sin(inner_theta) * 2.46 * 0.75))
        add_cylinder_between(f"Experience_ActuatorRam_{actuator:02d}", outer, inner, 0.115, mats["steel"], parent=actuators, vertices=14)
        add_cylinder(f"Experience_ActuatorPivot_{actuator:02d}", 0.24, 0.28, outer, mats["gunmetal"], parent=actuators, rotation=(math.pi / 2, 0, 0), vertices=18, bevel=0.04)
        add_cylinder(f"Experience_ActuatorPin_{actuator:02d}", 0.09, 0.34, outer + Vector((0, -0.05, 0)), mats["orange_dim"], parent=actuators, rotation=(math.pi / 2, 0, 0), vertices=12, bevel=0.018)

    # A faceted optical hood and sensor cassettes create a camera/observatory
    # silhouette rather than another ringed sphere.  The hood is intentionally
    # broken into overlapping vanes so the lens remains visible through it.
    hood = add_empty("Experience_AdaptiveOpticalHood", parent=hi)
    vane_profile = ((-0.58, -0.22), (-0.36, -0.52), (0.46, -0.44), (0.68, 0.0), (0.42, 0.48), (-0.38, 0.54), (-0.64, 0.2))
    for vane_index in range(10):
        theta = math.tau * vane_index / 10
        x = math.cos(theta) * 3.72 * 1.16
        z = math.sin(theta) * 3.72 * 0.78
        add_extruded_profile(
            f"Experience_HoodVane_{vane_index:02d}",
            vane_profile,
            0.5,
            (x, -1.78, z),
            mats["carbon" if vane_index % 2 else "titanium"],
            parent=hood,
            rotation=(0, theta, 0),
            bevel=0.055,
        )
        inner = Vector((x * 0.78, -1.82, z * 0.78))
        outer = Vector((x, -1.82, z))
        add_cylinder_between(
            f"Experience_HoodVaneLoadPath_{vane_index:02d}",
            inner,
            outer,
            0.085,
            mats["nickel"],
            parent=hood,
            vertices=12,
        )
    for sensor_index, (x, z) in enumerate(((-2.55, -1.38), (-2.62, 1.3), (2.55, -1.38), (2.62, 1.3))):
        add_bearing_stack(
            f"Experience_ParallaxSensor_{sensor_index}",
            (x, -2.72, z),
            Vector((0, -1, 0)),
            mats,
            parent=hood,
            radius=0.28,
            depth=0.48,
            signal=sensor_index == 3,
        )
        add_extruded_profile(
            f"Experience_SensorShroud_{sensor_index}",
            ((-0.42, -0.34), (0.3, -0.34), (0.48, -0.12), (0.42, 0.34), (-0.3, 0.42), (-0.5, 0.12)),
            0.32,
            (x, -2.58, z),
            mats["ceramic_dark"],
            parent=hood,
            bevel=0.045,
        )
    for key_index, theta in enumerate((-0.72, -0.24, 0.24, 0.72)):
        x = math.sin(theta) * 3.05
        z = -2.06 + abs(theta) * 0.42
        add_box(
            f"Experience_FocusEncoder_{key_index}",
            (0.34, 0.28, 0.16),
            (x, -3.03, z),
            mats["orange_dim" if key_index == 2 else "ceramic"],
            parent=hood,
            rotation=(0, 0, -theta * 0.35),
            bevel=0.04,
        )
    keyframe_cycle(iris, peak_rotation=(0, math.radians(4), math.radians(8)), action_name="SIGNATURE_EXPERIENCE_APERTURE_7S")

    add_uv_sphere("Experience_MID_OpticalVolume", 2.42, (0, 0, 0), mats["optical_blue"], parent=mid, segments=24, rings=12, scale=(1.15, 0.52, 0.72))
    for face_index, y in enumerate((-2.15, 1.88)):
        for sector in range(10):
            add_annular_sector(
                f"Experience_MID_{'Front' if face_index == 0 else 'Rear'}Frame_{sector:02d}",
                2.62,
                3.28,
                math.tau * sector / 10 + 0.025,
                math.tau * (sector + 1) / 10 - 0.025,
                0.4,
                y,
                mats["carbon" if sector % 2 else "titanium"],
                parent=mid,
                steps=5,
                scale_x=1.16,
                scale_z=0.77,
                bevel_width=0.055,
            )
    mid_iris = add_empty("Experience_MID_SIGNATURE_ACTION", parent=mid)
    mid_blade_count = 10
    for sector in range(mid_blade_count):
        pivot = add_empty(f"Experience_MID_IrisPivot_{sector:02d}", parent=mid_iris)
        add_iris_leaf(
            f"Experience_MID_IrisBlade_{sector:02d}",
            sector,
            mid_blade_count,
            0.58,
            2.28,
            0.24,
            -2.48 + 0.045 * ((sector % 3) - 1),
            mats["warm" if sector in (0, 5) else ("steel" if sector % 2 else "gunmetal")],
            parent=pivot,
            scale_x=1.12,
            scale_z=0.74,
            bevel_width=0.045,
        )
        keyframe_cycle(
            pivot,
            peak_rotation=(0, 0, math.radians(15 + sector * 0.55)),
            peak_scale=(0.93, 0.93, 0.93),
            action_name=f"SIGNATURE_EXPERIENCE_MID_IRIS_{sector:02d}_7S",
        )
        hinge_theta = math.tau * sector / mid_blade_count + math.tau / mid_blade_count * 0.5
        hinge_pos = Vector((math.cos(hinge_theta) * 2.15 * 1.12, -2.66 - 0.022 * (sector % 3), math.sin(hinge_theta) * 2.15 * 0.74))
        add_cylinder(f"Experience_MID_IrisHinge_{sector:02d}", 0.145, 0.24, hinge_pos, mats["orange_dim" if sector % 5 == 0 else "warm"], parent=pivot, rotation=(math.pi / 2, 0, 0), vertices=12, bevel=0.025)
    add_cylinder("Experience_MID_ApertureHub", 0.38, 0.38, (0, -2.3, 0), mats["graphite"], parent=mid_iris, rotation=(math.pi / 2, 0, 0), vertices=20, bevel=0.05)
    add_torus("Experience_MID_ApertureBearing", 0.65, 0.125, (0, -2.65, 0), mats["steel"], parent=mid_iris, rotation=(math.pi / 2, 0, 0), scale=(1.12, 1, 0.74), major_segments=32, minor_segments=7)
    add_torus(
        "Experience_MID_IrisSignalSeam",
        0.54,
        0.065,
        (0, -2.64, 0),
        mats["orange_dim"],
        parent=mid_iris,
        rotation=(math.pi / 2, 0, 0),
        scale=(1.12, 1, 0.74),
        major_segments=32,
        minor_segments=6,
    )
    add_torus(
        "Experience_MID_IrisSignalBearing",
        0.52,
        0.085,
        (0, -2.6, 0),
        mats["orange_dim"],
        parent=mid_iris,
        rotation=(math.pi / 2, 0, 0),
        scale=(1.12, 1.0, 0.74),
        major_segments=32,
        minor_segments=7,
    )
    for rail in range(8):
        theta = math.tau * rail / 8
        x = math.cos(theta) * 3.0 * 1.16
        z = math.sin(theta) * 3.0 * 0.77
        add_cylinder_between(f"Experience_MID_BarrelRail_{rail:02d}", Vector((x, -1.96, z)), Vector((x, 1.7, z)), 0.13, mats["steel"], parent=mid, vertices=12)
    for actuator in range(6):
        theta = math.tau * actuator / 6
        outer = Vector((math.cos(theta) * 3.42 * 1.14, -2.55, math.sin(theta) * 3.42 * 0.75))
        inner = Vector((math.cos(theta + 0.2) * 2.3 * 1.12, -2.62, math.sin(theta + 0.2) * 2.3 * 0.74))
        add_cylinder_between(f"Experience_MID_Actuator_{actuator:02d}", outer, inner, 0.12, mats["gunmetal"], parent=mid_iris, vertices=12)
        add_cylinder(f"Experience_MID_Pivot_{actuator:02d}", 0.2, 0.25, outer, mats["orange_dim" if actuator % 3 == 0 else "warm"], parent=mid_iris, rotation=(math.pi / 2, 0, 0), vertices=14, bevel=0.03)
    for vane_index in range(6):
        theta = math.tau * vane_index / 6
        add_extruded_profile(
            f"Experience_MID_HoodVane_{vane_index:02d}",
            vane_profile,
            0.42,
            (math.cos(theta) * 3.48 * 1.14, -1.65, math.sin(theta) * 3.48 * 0.76),
            mats["carbon" if vane_index % 2 else "titanium"],
            parent=mid,
            rotation=(0, theta, 0),
            bevel=0.05,
        )
    add_uv_sphere("Experience_LOW_Silhouette", 3.2, (0, 0, 0), mats["graphite"], parent=low, segments=20, rings=10, scale=(1.27, 0.7, 0.8))
    return root


def build_experience(meta, parent, mats):
    """Author the asymmetric twin-optic EXPERIENCE world.

    The legacy circular iris generator is retained above only for source
    comparison; this function is the exported asset builder used by main().
    """
    root, hi, mid, low = asset_root(
        "Planet_experience_ROOT", parent=parent, loc=planet_position(meta), asset_id="experience",
        service=meta["service"], radius=meta["radius"], signature=meta["signature"]
    )
    root["code"] = meta["code"]
    body_profile = (
        (-3.5, -1.65), (-2.65, -2.45), (-0.55, -2.62), (0.35, -2.2),
        (2.75, -1.9), (3.55, -0.82), (3.3, 1.32), (2.35, 2.18),
        (-0.5, 2.55), (-2.9, 2.12), (-3.72, 0.78),
    )
    add_extruded_profile("Experience_DeepOpticalBody", body_profile, 4.35, (0, 0.42, 0), mats["carbon"], parent=hi, bevel=0.15)
    add_extruded_profile(
        "Experience_RearOpticalBody", tuple((x * 0.9, z * 0.86) for x, z in body_profile),
        4.65, (0, 0.78, 0), mats["ceramic_dark"], parent=hi, bevel=0.12
    )
    frame = add_empty("Experience_ThickLensFrame", parent=hi)
    lens_specs = (
        ("PRIMARY", Vector((-0.88, 0, 0.38)), 1.78, 1.0, 0.86),
        ("SECONDARY", Vector((1.78, 0, -0.62)), 1.02, 0.92, 0.9),
    )
    for lens_index, (lens_id, offset, radius, scale_x, scale_z) in enumerate(lens_specs):
        group = add_empty(f"Experience_{lens_id}_LensGroup", parent=frame, loc=(offset.x, 0, offset.z))
        for glass_index, (y, scale, glass_mat) in enumerate(((-2.5, 1.0, "glass"), (-1.9, 0.87, "optical_blue"), (-1.3, 0.69, "glass"))):
            add_uv_sphere(
                "Experience_OpticalVolume" if lens_index == 0 and glass_index == 0 else f"Experience_{lens_id}_OpticalVolume_{glass_index}",
                radius, (0, y, 0), mats[glass_mat], parent=group,
                segments=32 if lens_index == 0 else 24, rings=16 if lens_index == 0 else 12,
                scale=(scale_x * scale, 0.24 + glass_index * 0.05, scale_z * scale),
            )
        for depth_index, y in enumerate((-2.72, -1.98, -1.3)):
            for sector in range(8):
                add_annular_sector(
                    f"Experience_{lens_id}_FrameSector_{depth_index}_{sector:02d}",
                    radius * (0.91 - depth_index * 0.08), radius * (1.18 - depth_index * 0.06),
                    math.tau * sector / 8 + 0.025, math.tau * (sector + 1) / 8 - 0.025,
                    0.32, y, mats["titanium" if (sector + depth_index) % 2 else "carbon"], parent=group,
                    steps=5, scale_x=scale_x, scale_z=scale_z, bevel_width=0.05,
                )
        for rail_index, theta in enumerate((math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4)):
            x = math.cos(theta) * radius * 1.08 * scale_x
            z = math.sin(theta) * radius * 1.08 * scale_z
            add_cylinder_between(
                f"Experience_{lens_id}_BarrelRail_{rail_index}", Vector((x, -2.48, z)), Vector((x, 1.5, z)),
                0.13 if lens_index == 0 else 0.1, mats["nickel"], parent=group, vertices=12,
            )

    # The animated iris lives only inside the primary lens.
    iris = add_empty("Experience_SIGNATURE_ACTION", parent=hi, loc=(-0.88, -2.86, 0.38))
    for blade_index in range(7):
        pivot = add_empty(f"Experience_IrisPivot_{blade_index:02d}", parent=iris)
        blade = add_iris_leaf(
            f"Experience_IrisBlade_{blade_index:02d}", blade_index, 7, 0.4, 1.46, 0.19,
            0.025 * ((blade_index % 3) - 1),
            mats["ceramic" if blade_index == 0 else ("carbon" if blade_index % 2 else "titanium")],
            parent=pivot, scale_x=1.0, scale_z=0.86, bevel_width=0.045,
        )
        blade["adaptiveAperturePart"] = True
        keyframe_cycle(
            pivot, peak_rotation=(0, 0, math.radians(16 + blade_index * 0.8)), peak_scale=(0.92, 0.92, 0.92),
            action_name=f"SIGNATURE_EXPERIENCE_IRIS_{blade_index:02d}_7S",
        )
        theta = math.tau * blade_index / 7 + math.tau / 14
        add_bearing_stack(
            f"Experience_IrisHinge_{blade_index:02d}",
            (math.cos(theta) * 1.35, -0.12, math.sin(theta) * 1.35 * 0.86), Vector((0, -1, 0)),
            mats, parent=pivot, radius=0.13, depth=0.24, signal=False,
        )
    add_torus("Experience_ApertureBearing", 0.48, 0.11, (0, -0.1, 0), mats["titanium"], parent=iris, rotation=(math.pi / 2, 0, 0), scale=(1, 1, 0.86), major_segments=32, minor_segments=7)
    add_box("Experience_IrisSignalSeam", (0.04, 0.06, 0.38), (0.46, -0.18, 0), mats["orange_dim"], parent=iris, bevel=0.01)
    keyframe_cycle(iris, peak_rotation=(0, math.radians(4), math.radians(8)), action_name="SIGNATURE_EXPERIENCE_APERTURE_7S")

    actuators = add_empty("Experience_ExposedActuators", parent=hi)
    actuator_paths = (
        (Vector((-2.9, -2.56, 1.55)), Vector((-2.05, -2.74, 1.02))),
        (Vector((0.42, -2.64, 2.0)), Vector((-0.1, -2.76, 1.36))),
        (Vector((2.92, -2.5, 0.58)), Vector((2.46, -2.68, 0.02))),
        (Vector((2.7, -2.52, -1.64)), Vector((2.18, -2.7, -1.1))),
    )
    for actuator, (outer, inner) in enumerate(actuator_paths):
        add_cylinder_between(f"Experience_ActuatorRam_{actuator:02d}", outer, inner, 0.14, mats["nickel"], parent=actuators, vertices=14)
        add_bearing_stack(f"Experience_ActuatorPivot_{actuator:02d}", outer, Vector((0, -1, 0)), mats, parent=actuators, radius=0.22, depth=0.4, signal=False)

    hood = add_empty("Experience_AdaptiveOpticalHood", parent=hi)
    vane_profile = ((-1.15, -0.42), (-0.42, -0.82), (0.92, -0.7), (1.28, -0.12), (0.96, 0.7), (-0.12, 0.86), (-1.1, 0.48))
    hood_specs = (
        ("PRIMARY_TOP", -1.25, 2.2, -0.12), ("PRIMARY_BOTTOM", -1.45, -1.68, math.pi),
        ("SECONDARY_TOP", 2.18, 1.15, 0.16), ("SECONDARY_OUTER", 3.08, -0.48, math.pi / 2),
    )
    for vane_index, (hood_id, x, z, rotation_y) in enumerate(hood_specs):
        add_extruded_profile(
            f"Experience_HoodVane_{hood_id}", vane_profile, 1.48, (x, -1.96, z),
            mats["carbon" if vane_index % 2 else "titanium"], parent=hood, rotation=(0, rotation_y, 0), bevel=0.09,
        )
        add_cylinder_between(
            f"Experience_HoodVaneLoadPath_{vane_index:02d}", Vector((x * 0.7, -1.1, z * 0.7)),
            Vector((x * 0.94, -1.7, z * 0.94)), 0.14, mats["nickel"], parent=hood, vertices=12,
        )
    add_box("Experience_FocusEncoder", (0.46, 0.28, 0.18), (0.54, -2.92, -1.72), mats["orange_dim"], parent=hood, bevel=0.04)

    # Balanced mirrors the twin optics, deep body and split hood.
    add_extruded_profile("Experience_MID_DeepOpticalBody", tuple((x * 0.94, z * 0.94) for x, z in body_profile), 4.0, (0, 0.35, 0), mats["carbon"], parent=mid, bevel=0.14)
    for lens_index, (lens_id, offset, radius, scale_x, scale_z) in enumerate(lens_specs):
        group = add_empty(f"Experience_MID_{lens_id}_LensGroup", parent=mid, loc=(offset.x, 0, offset.z))
        for glass_index, (y, scale) in enumerate(((-2.38, 1.0), (-1.62, 0.72))):
            add_uv_sphere(
                "Experience_MID_OpticalVolume" if lens_index == 0 and glass_index == 0 else f"Experience_MID_{lens_id}_OpticalVolume_{glass_index}",
                radius, (0, y, 0), mats["optical_blue" if glass_index else "glass"], parent=group,
                segments=24, rings=12, scale=(scale_x * scale, 0.26, scale_z * scale),
            )
        for sector in range(8):
            add_annular_sector(
                f"Experience_MID_{lens_id}_Frame_{sector:02d}", radius * 0.9, radius * 1.2,
                math.tau * sector / 8 + 0.03, math.tau * (sector + 1) / 8 - 0.03,
                0.34, -2.58, mats["carbon" if sector % 2 else "titanium"], parent=group,
                steps=4, scale_x=scale_x, scale_z=scale_z, bevel_width=0.05,
            )
    mid_iris = add_empty("Experience_MID_SIGNATURE_ACTION", parent=mid, loc=(-0.88, -2.74, 0.38))
    for sector in range(6):
        pivot = add_empty(f"Experience_MID_IrisPivot_{sector:02d}", parent=mid_iris)
        add_iris_leaf(
            f"Experience_MID_IrisBlade_{sector:02d}", sector, 6, 0.38, 1.4, 0.2,
            0.02 * ((sector % 3) - 1), mats["ceramic" if sector == 0 else ("titanium" if sector % 2 else "carbon")],
            parent=pivot, scale_x=1.0, scale_z=0.86, bevel_width=0.045,
        )
        keyframe_cycle(
            pivot, peak_rotation=(0, 0, math.radians(14 + sector * 0.7)), peak_scale=(0.94, 0.94, 0.94),
            action_name=f"SIGNATURE_EXPERIENCE_MID_IRIS_{sector:02d}_7S",
        )
    for vane_index, (hood_id, x, z, rotation_y) in enumerate(hood_specs):
        add_extruded_profile(
            f"Experience_MID_HoodVane_{hood_id}", tuple((px * 0.9, pz * 0.9) for px, pz in vane_profile),
            1.28, (x, -1.8, z), mats["carbon" if vane_index % 2 else "titanium"], parent=mid,
            rotation=(0, rotation_y, 0), bevel=0.085,
        )
    add_box("Experience_MID_FocusEncoder", (0.38, 0.24, 0.14), (0.5, -2.78, -1.56), mats["orange_dim"], parent=mid, bevel=0.035)
    add_extruded_profile("Experience_LOW_Body", tuple((x * 0.9, z * 0.9) for x, z in body_profile), 3.8, (0, 0.2, 0), mats["graphite"], parent=low, bevel=0.14)
    add_uv_sphere("Experience_LOW_PrimaryLens", 1.62, (-0.82, -2.1, 0.36), mats["optical_blue"], parent=low, segments=20, rings=10, scale=(1, 0.26, 0.86))
    add_uv_sphere("Experience_LOW_SecondaryLens", 0.94, (1.68, -2.05, -0.58), mats["glass"], parent=low, segments=16, rings=8, scale=(0.92, 0.28, 0.9))
    return root


def build_test(meta, parent, mats):
    root, hi, mid, low = asset_root("Planet_test_ROOT", parent=parent, loc=planet_position(meta), asset_id="test", service=meta["service"], radius=meta["radius"], signature=meta["signature"])
    root["code"] = meta["code"]
    add_ico("Test_ValidationCore", 1.98, (0, 0, 0), mats["gunmetal"], parent=hi, subdivisions=3)
    add_structural_cage("Test_Validation", hi, 1.35, 3.25, mats, ring_minor=0.18, strut_count=12)
    shell = add_empty("Test_SIGNATURE_ACTION", parent=hi)
    add_spherical_patch("Test_OuterShell_A", 3.55, -math.pi * 0.42, math.pi * 0.42, mats["warm"], parent=shell, thickness=0.15)
    add_spherical_patch("Test_OuterShell_B", 3.55, math.pi * 0.58, math.pi * 1.42, mats["steel"], parent=shell, thickness=0.15)
    add_segmented_armour_shell(
        "Test_InspectionShell_A",
        shell,
        3.66,
        mats,
        bands=4,
        segments=6,
        theta_start=-math.pi * 0.42,
        theta_end=math.pi * 0.42,
        thickness=0.19,
        material_cycle=("ceramic", "titanium", "gunmetal"),
        skip={(1, 2), (3, 4)},
        fastener_stride=3,
    )
    add_segmented_armour_shell(
        "Test_InspectionShell_B",
        shell,
        3.64,
        mats,
        bands=4,
        segments=6,
        theta_start=math.pi * 0.58,
        theta_end=math.pi * 1.42,
        thickness=0.2,
        material_cycle=("carbon", "gunmetal", "titanium"),
        skip={(0, 1), (2, 3)},
        fastener_stride=3,
    )
    scan = add_empty("Test_ScannerAssembly", parent=hi)
    for i, rotation in enumerate(((0, 0, 0), (math.pi / 2, 0, 0), (0, math.pi / 2, 0))):
        # These are narrow datum rails inside a larger metrology frame, not
        # the primary silhouette.  Their restrained section keeps TEST from
        # reading as another sphere with decorative rings.
        add_torus(f"Test_MeasurementRing_{i}", 3.78 + i * 0.12, 0.12 if i < 2 else 0.095, (0, 0, 0), mats["carbon" if i < 2 else "titanium"], parent=scan, rotation=rotation, major_segments=64, minor_segments=8)
    add_torus("Test_ScanLatitude", 3.95, 0.055, (0, 0, 0), mats["orange_dim"], parent=scan, rotation=(0, 0, 0), major_segments=64, minor_segments=6)

    # Twin asymmetric measurement yokes clamp the split shells from outside.
    # Their deep sidewalls, bearings and triangulated load paths create the
    # recognisable silhouette even when the spherical core is in shadow.
    yoke_profile = ((-0.48, -2.1), (0.18, -2.38), (0.54, -1.88), (0.46, 1.82), (0.1, 2.34), (-0.52, 2.02), (-0.66, 0.58), (-0.62, -0.72))
    yoke_centres = ((-3.72, -0.32, 0.16), (3.72, -0.42, -0.12))
    for yoke_index, centre in enumerate(yoke_centres):
        sign = -1 if yoke_index == 0 else 1
        add_extruded_profile(
            f"Test_MetrologyYoke_{'WEST' if sign < 0 else 'EAST'}",
            yoke_profile,
            1.72,
            centre,
            mats["carbon" if sign < 0 else "titanium"],
            parent=hi,
            rotation=(0, 0, math.pi if sign > 0 else 0),
            bevel=0.1,
        )
        add_extruded_profile(
            f"Test_MetrologyYokeFace_{yoke_index:02d}",
            tuple((x * 0.68, z * 0.9) for x, z in yoke_profile),
            1.86,
            (centre[0], centre[1] - 0.12, centre[2]),
            mats["nickel" if yoke_index else "ceramic_dark"],
            parent=hi,
            rotation=(0, 0, math.pi if sign > 0 else 0),
            bevel=0.065,
        )
        for bearing_index, z in enumerate((-1.56, 0.0, 1.56)):
            bearing_loc = (sign * 3.58, -1.34, z)
            add_bearing_stack(
                f"Test_YokeBearing_{yoke_index:02d}_{bearing_index:02d}",
                bearing_loc,
                Vector((0, -1, 0)),
                mats,
                parent=hi,
                radius=0.2 if bearing_index != 1 else 0.25,
                depth=0.44,
                signal=(yoke_index, bearing_index) == (1, 1),
            )
            add_cylinder_between(
                f"Test_YokeLoadPath_{yoke_index:02d}_{bearing_index:02d}",
                Vector(bearing_loc) + Vector((0, 0.24, 0)),
                Vector((sign * 2.38, -0.66, z * 0.78)),
                0.12,
                mats["nickel"],
                parent=hi,
                vertices=12,
            )
    for i in range(8):
        theta = math.tau * i / 8
        n = Vector((math.cos(theta), math.sin(theta), 0))
        pos = n * 4.15
        arm = add_box(f"Test_CalibrationArm_{i:02d}", (0.34, 1.08, 0.42), pos, mats["gunmetal"], parent=hi, rotation=(0, 0, theta + math.pi / 2), bevel=0.05)
        arm["calibrationFixture"] = True
        add_box(f"Test_CalibrationJaw_{i:02d}", (0.65, 0.38, 0.68), n * 3.62, mats["warm" if i % 2 == 0 else "steel"], parent=hi, rotation=(0, 0, theta), bevel=0.06)
        add_cylinder(f"Test_Probe_{i:02d}", 0.09, 0.72, n * 3.28, mats["orange_dim"], parent=hi, vertices=12, bevel=0.015)
        orient_z_to(bpy.context.object, n)
    add_planet_panel_bands("Test", hi, 3.7, mats, count=18)
    for row, z in enumerate((-1.9, -0.65, 0.65, 1.9)):
        for column, x in enumerate((-2.0, -0.66, 0.66, 2.0)):
            y = -math.sqrt(max(0.8, 3.5**2 - x**2 - z**2))
            normal = Vector((x, y, z)).normalized()
            add_panel_on_sphere(
                f"Test_InspectionPanel_{row}_{column}",
                normal,
                3.62,
                (0.98, 0.78, 0.12),
                mats["warm" if column >= 2 else "graphite"],
                parent=hi,
                twist=0.04 * (row + column),
            )
            add_bolt_on_sphere(
                f"Test_InspectionFastener_{row}_{column}",
                normal,
                3.77,
                mats["steel" if row % 2 else "orange_dim"],
                parent=hi,
                size=0.06,
            )
    validation_face = add_empty("Test_HeroValidationGantry", parent=hi)
    gate_profile = ((-1.34, -0.72), (-0.72, -1.34), (0.72, -1.34), (1.34, -0.72), (1.34, 0.72), (0.72, 1.34), (-0.72, 1.34), (-1.34, 0.72))
    # A true open reference gate replaces the previous solid octagonal plate.
    # The nested segmented collars expose the core and make the scanner path
    # physically readable through several layers of depth.
    for layer, (inner, outer, depth, y) in enumerate(((1.18, 1.76, 0.44, -3.42), (1.28, 1.58, 0.54, -3.72))):
        for sector in range(8):
            name = (
                "Test_ReferenceApertureBack" if layer == 0 and sector == 0
                else "Test_ReferenceApertureFace" if layer == 1 and sector == 0
                else f"Test_ReferenceAperture_{'Back' if layer == 0 else 'Face'}Sector_{sector:02d}"
            )
            add_annular_sector(
                name,
                inner,
                outer,
                math.tau * sector / 8 + 0.035,
                math.tau * (sector + 1) / 8 - 0.035,
                depth,
                y,
                mats["carbon" if layer == 0 else ("ceramic" if sector % 2 == 0 else "titanium")],
                parent=validation_face,
                steps=3,
                bevel_width=0.055 if layer == 0 else 0.045,
            )
    for datum_index, theta in enumerate((0, math.pi / 2, math.pi, 3 * math.pi / 2)):
        point = Vector((math.cos(theta) * 1.72, -3.93, math.sin(theta) * 1.72))
        add_bearing_stack(
            f"Test_ReferenceDatum_{datum_index:02d}",
            point,
            Vector((0, -1, 0)),
            mats,
            parent=validation_face,
            radius=0.17,
            depth=0.32,
            signal=datum_index == 1,
        )

    scanner_carriage = add_empty("Test_OpticalScannerCarriage", parent=scan)
    add_box("Test_OpticalScannerBridge", (3.02, 0.34, 0.28), (0, -4.06, 0.24), mats["carbon"], parent=scanner_carriage, bevel=0.055)
    add_box("Test_OpticalScannerSlit", (2.18, 0.08, 0.055), (0, -4.27, 0.24), mats["orange_dim"], parent=scanner_carriage, bevel=0.012)
    for side in (-1, 1):
        add_bearing_stack(
            f"Test_ScannerBridgeBearing_{'L' if side < 0 else 'R'}",
            (side * 1.46, -4.08, 0.24),
            Vector((0, -1, 0)),
            mats,
            parent=scanner_carriage,
            radius=0.16,
            depth=0.3,
            signal=False,
        )
    for rail_index, x in enumerate((-2.42, 2.42)):
        add_box(f"Test_MetrologyRail_{rail_index}", (0.26, 0.38, 4.9), (x, -3.12, 0), mats["titanium"], parent=validation_face, bevel=0.045)
        for carriage, z in enumerate((-1.7, 0, 1.7)):
            add_bearing_stack(
                f"Test_ProbeCarriage_{rail_index}_{carriage}",
                (x, -3.42, z),
                Vector((0, -1, 0)),
                mats,
                parent=validation_face,
                radius=0.18,
                depth=0.34,
                signal=(rail_index, carriage) == (1, 1),
            )
            add_cylinder_between(
                f"Test_ProbeStylus_{rail_index}_{carriage}",
                Vector((x, -3.58, z)),
                Vector((x * 0.58, -3.72, z * 0.72)),
                0.055,
                mats["nickel"],
                parent=validation_face,
                vertices=10,
            )
    for tick in range(17):
        x = -1.92 + tick * 0.24
        add_box(
            f"Test_ReferenceTick_{tick:02d}",
            (0.055 if tick % 4 else 0.08, 0.08, 0.28 if tick % 4 else 0.48),
            (x, -3.96, -2.45),
            mats["orange_dim" if tick in (0, 8, 16) else "nickel"],
            parent=validation_face,
            bevel=0.012,
        )
    # Four corner fixtures establish an explicit calibration volume around the
    # open gate.  Each jaw has a carriage, ram and replaceable probe tip.
    for fixture, (x, z) in enumerate(((-3.06, -2.35), (3.06, -2.35), (-3.06, 2.35), (3.06, 2.35))):
        sx = -1 if x < 0 else 1
        sz = -1 if z < 0 else 1
        add_box(
            f"Test_CornerFixture_{fixture:02d}",
            (0.72, 1.0, 0.62),
            (x, -2.62, z),
            mats["carbon"],
            parent=validation_face,
            bevel=0.085,
        )
        add_box(
            f"Test_CornerFixtureJaw_{fixture:02d}",
            (0.86, 0.42, 0.32),
            (x - sx * 0.35, -3.18, z - sz * 0.26),
            mats["titanium"],
            parent=validation_face,
            rotation=(0, 0, -sx * sz * 0.18),
            bevel=0.055,
        )
        add_cylinder_between(
            f"Test_CornerFixtureRam_{fixture:02d}",
            Vector((x, -2.94, z)),
            Vector((sx * 1.42, -3.54, sz * 1.08)),
            0.09,
            mats["nickel"],
            parent=validation_face,
            vertices=12,
        )
        add_cylinder(
            f"Test_CornerProbeTip_{fixture:02d}",
            0.095,
            0.22,
            (sx * 1.38, -3.66, sz * 1.05),
            mats["orange_dim" if fixture == 3 else "ceramic"],
            parent=validation_face,
            rotation=(math.pi / 2, 0, 0),
            vertices=12,
            bevel=0.015,
        )
    keyframe_cycle(shell, peak_scale=(1.08, 1.08, 1.08), peak_rotation=(math.radians(6), 0, math.radians(-12)), action_name="SIGNATURE_TEST_SHELL_7S")
    keyframe_cycle(scan, peak_rotation=(math.radians(90), math.radians(35), math.radians(125)), action_name="SIGNATURE_TEST_SCAN_7S")

    add_ico("Test_MID_Core", 2.05, (0, 0, 0), mats["gunmetal"], parent=mid, subdivisions=2)
    add_structural_cage("Test_MID", mid, 1.4, 3.16, mats, ring_minor=0.17, strut_count=7, ring_count=2)
    add_segmented_armour_shell(
        "Test_MID_Shell_A",
        mid,
        3.52,
        mats,
        bands=3,
        segments=5,
        theta_start=-math.pi * 0.42,
        theta_end=math.pi * 0.42,
        thickness=0.18,
        material_cycle=("ceramic", "titanium"),
        skip={(1, 2)},
        fastener_stride=3,
        tile_theta_segments=3,
        tile_phi_segments=3,
    )
    add_segmented_armour_shell(
        "Test_MID_Shell_B",
        mid,
        3.52,
        mats,
        bands=3,
        segments=5,
        theta_start=math.pi * 0.58,
        theta_end=math.pi * 1.42,
        thickness=0.18,
        material_cycle=("carbon", "titanium"),
        skip={(1, 3)},
        fastener_stride=3,
        tile_theta_segments=3,
        tile_phi_segments=3,
    )
    for i, rotation in enumerate(((0, 0, 0), (math.pi / 2, 0, 0))):
        add_torus(f"Test_MID_Ring_{i}", 3.72 + 0.16 * i, 0.18, (0, 0, 0), mats["gunmetal" if i == 0 else "steel"], parent=mid, rotation=rotation, major_segments=36, minor_segments=8)
    add_torus("Test_MID_ScanSignal", 3.94, 0.05, (0, 0, 0), mats["orange_dim"], parent=mid, rotation=(math.pi / 2, 0, 0), major_segments=36, minor_segments=5)
    for i in range(6):
        n = radial_vector(i, 6)
        add_box(f"Test_MID_Clamp_{i}", (0.48, 0.9, 0.55), n * 3.65, mats["warm"], parent=mid, rotation=(0, 0, i * math.tau / 6))
    for sector in range(8):
        add_annular_sector(
            "Test_MID_ReferenceAperture" if sector == 0 else f"Test_MID_ReferenceApertureSector_{sector:02d}",
            1.15,
            1.68,
            math.tau * sector / 8 + 0.04,
            math.tau * (sector + 1) / 8 - 0.04,
            0.44,
            -3.42,
            mats["ceramic" if sector % 2 == 0 else "carbon"],
            parent=mid,
            steps=3,
            bevel_width=0.05,
        )
    for rail_index, x in enumerate((-2.25, 2.25)):
        add_box(f"Test_MID_MetrologyRail_{rail_index}", (0.28, 0.36, 4.35), (x, -3.0, 0), mats["titanium"], parent=mid, bevel=0.045)
    for yoke_index, centre in enumerate(((-3.55, -0.25, 0.12), (3.55, -0.3, -0.1))):
        add_extruded_profile(
            f"Test_MID_MetrologyYoke_{yoke_index:02d}",
            tuple((x * 0.9, z * 0.92) for x, z in yoke_profile),
            1.48,
            centre,
            mats["carbon" if yoke_index == 0 else "titanium"],
            parent=mid,
            rotation=(0, 0, math.pi if yoke_index else 0),
            bevel=0.085,
        )
        sign = -1 if yoke_index == 0 else 1
        for z in (-1.45, 1.45):
            add_cylinder_between(
                f"Test_MID_YokeLoadPath_{yoke_index:02d}_{'N' if z > 0 else 'S'}",
                Vector((sign * 3.42, -1.12, z)),
                Vector((sign * 2.18, -0.58, z * 0.78)),
                0.11,
                mats["nickel"],
                parent=mid,
                vertices=10,
            )
    add_box("Test_MID_OpticalScannerBridge", (2.78, 0.3, 0.24), (0, -3.9, 0.22), mats["carbon"], parent=mid, bevel=0.05)
    add_box("Test_MID_OpticalScannerSlit", (1.96, 0.075, 0.05), (0, -4.08, 0.22), mats["orange_dim"], parent=mid, bevel=0.01)
    add_ico("Test_LOW_Silhouette", 3.3, (0, 0, 0), mats["graphite"], parent=low, subdivisions=2)
    add_torus("Test_LOW_Scan", 3.65, 0.15, (0, 0, 0), mats["orange"], parent=low, rotation=(math.pi / 2, 0, 0), major_segments=24, minor_segments=5)
    return root


def build_deploy(meta, parent, mats):
    root, hi, mid, low = asset_root("Planet_deploy_ROOT", parent=parent, loc=planet_position(meta), asset_id="deploy", service=meta["service"], radius=meta["radius"], signature=meta["signature"])
    root["code"] = meta["code"]
    add_ico("Deploy_CloudCore", 2.38, (0, 0, 0), mats["gunmetal"], parent=hi, subdivisions=3)
    add_structural_cage("Deploy_Cloud", hi, 1.62, 3.36, mats, ring_minor=0.21, strut_count=14)
    add_segmented_armour_shell(
        "Deploy_Cloud",
        hi,
        3.52,
        mats,
        bands=4,
        segments=12,
        thickness=0.23,
        skip={(0, 2), (0, 8), (1, 5), (2, 0), (2, 10), (3, 4), (3, 7)},
        material_cycle=("carbon", "gunmetal", "titanium", "nickel"),
        fastener_stride=4,
    )
    add_torus("Deploy_EquatorialDock", 4.0, 0.35, (0, 0, 0), mats["gunmetal"], parent=hi, major_segments=64, minor_segments=10)
    add_torus("Deploy_ContainerBus", 4.35, 0.18, (0, 0, 0), mats["steel"], parent=hi, major_segments=64, minor_segments=9)
    add_torus("Deploy_ContainerSignalSeam", 4.37, 0.045, (0, 0, 0), mats["orange_dim"], parent=hi, major_segments=64, minor_segments=5)
    docks = add_empty("Deploy_SIGNATURE_ACTION", parent=hi)
    for i in range(20):
        theta = math.tau * i / 20
        n = Vector((math.cos(theta), math.sin(theta), 0))
        tangent = Vector((-n.y, n.x, 0))
        base = n * 4.0 + Vector((0, 0, 0.46 if i % 2 else -0.46))
        dock = add_box(f"Deploy_DockArm_{i:02d}", (0.54, 1.5 + 0.18 * (i % 3), 0.5), base + n * 0.72, mats["steel" if i % 4 else "warm"], parent=docks, rotation=(0, 0, theta + math.pi / 2), bevel=0.06)
        dock["deploymentDock"] = True
        add_cylinder_between(f"Deploy_DockSupport_{i:02d}", n * 3.28 + Vector((0, 0, base.z)), base + n * 0.92, 0.105, mats["gunmetal"], parent=docks, vertices=12)
        for stack in range(2):
            p = base + n * (1.45 + stack * 0.55) + tangent * (0.16 if stack else -0.16)
            add_box(f"Deploy_Container_{i:02d}_{stack}", (0.48, 0.72, 0.38), p, mats["gunmetal" if stack else "warm"], parent=docks, rotation=(0, 0, theta + math.pi / 2), bevel=0.045)
        add_box(
            f"Deploy_StatusRail_{i:02d}",
            (0.12, 0.85, 0.07),
            base + n * 1.78 + Vector((0, 0, 0.24)),
            mats["orange_dim" if i % 5 == 0 else "nickel"],
            parent=docks,
            rotation=(0, 0, theta + math.pi / 2),
            bevel=0.015,
        )
    for hemisphere, sign in enumerate((-1, 1)):
        for i in range(15):
            theta = math.tau * i / 15 + hemisphere * 0.08
            z = sign * (1.0 + (i % 3) * 0.76)
            r = math.sqrt(max(2.0, 3.8**2 - z**2))
            p = Vector((math.cos(theta) * r, math.sin(theta) * r, z))
            add_panel_on_sphere(f"Deploy_RackContinent_{hemisphere}_{i:02d}", p.normalized(), p.length + 0.2, (0.72, 0.58, 0.42 + 0.12 * (i % 4)), mats["graphite" if i % 3 else "steel"], parent=hi, twist=theta)

    # The hero face is a deployment canyon: two rack continents carry the
    # mass while a deep open axial lane remains clear between them.  Repeated
    # rack bays have explicit shelves, vents, couplers and load ribs, so they
    # read as infrastructure rather than surface decoration.
    rack_cliff_profile = ((-0.84, -2.48), (0.26, -2.7), (0.82, -2.18), (0.9, 1.9), (0.5, 2.62), (-0.36, 2.72), (-0.92, 2.18), (-1.02, -1.72))
    for cliff_index, sign in enumerate((-1, 1)):
        cliff_x = sign * 3.02
        add_extruded_profile(
            f"Deploy_RackCliff_{'WEST' if sign < 0 else 'EAST'}",
            rack_cliff_profile,
            2.18,
            (cliff_x, -0.54, 0),
            mats["carbon" if sign < 0 else "titanium"],
            parent=docks,
            rotation=(0, 0, math.pi if sign > 0 else 0),
            bevel=0.12,
        )
        add_extruded_profile(
            f"Deploy_RackCliffFace_{cliff_index:02d}",
            tuple((x * 0.72, z * 0.91) for x, z in rack_cliff_profile),
            2.34,
            (cliff_x, -0.68, 0),
            mats["ceramic_dark" if sign < 0 else "nickel"],
            parent=docks,
            rotation=(0, 0, math.pi if sign > 0 else 0),
            bevel=0.075,
        )
        for tier, z in enumerate((-1.72, -0.58, 0.58, 1.72)):
            for bay, x_offset in enumerate((-0.38, 0.34)):
                bay_x = cliff_x + sign * x_offset
                add_box(
                    f"Deploy_RackBay_{cliff_index:02d}_{tier:02d}_{bay:02d}",
                    (0.54, 0.34, 0.72),
                    (bay_x, -2.02, z),
                    mats["gunmetal" if (tier + bay) % 2 else "carbon"],
                    parent=docks,
                    bevel=0.055,
                )
                add_box(
                    f"Deploy_RackBayFace_{cliff_index:02d}_{tier:02d}_{bay:02d}",
                    (0.4, 0.08, 0.54),
                    (bay_x, -2.24, z),
                    mats["titanium"],
                    parent=docks,
                    bevel=0.028,
                )
                for vent in range(3):
                    add_box(
                        f"Deploy_RackVent_{cliff_index:02d}_{tier:02d}_{bay:02d}_{vent:02d}",
                        (0.28, 0.045, 0.035),
                        (bay_x, -2.3, z - 0.11 + vent * 0.11),
                        mats["nickel"],
                        parent=docks,
                        bevel=0.008,
                    )
            add_box(
                f"Deploy_RackShelf_{cliff_index:02d}_{tier:02d}",
                (1.46, 0.28, 0.13),
                (cliff_x, -1.92, z - 0.48),
                mats["titanium"],
                parent=docks,
                bevel=0.025,
            )
            add_bearing_stack(
                f"Deploy_RackCoupler_{cliff_index:02d}_{tier:02d}",
                (cliff_x - sign * 0.82, -2.14, z),
                Vector((0, -1, 0)),
                mats,
                parent=docks,
                radius=0.15,
                depth=0.3,
                signal=(cliff_index, tier) == (1, 2),
            )
        for rib_index, z in enumerate((-1.86, 0, 1.86)):
            add_cylinder_between(
                f"Deploy_RackCliffLoadRib_{cliff_index:02d}_{rib_index:02d}",
                Vector((sign * 1.38, 0.38, z * 0.5)),
                Vector((cliff_x - sign * 0.2, -0.24, z)),
                0.15,
                mats["nickel" if rib_index == 1 else "titanium"],
                parent=docks,
                vertices=14,
            )

    # Four receding segmented collars and longitudinal lane rails make the
    # central deployment passage genuinely traversable.  Nothing fills the
    # inner 2.2-unit aperture.
    for collar_index, (y, inner, outer) in enumerate(((-3.72, 1.12, 1.72), (-2.82, 1.0, 1.56), (-1.94, 0.88, 1.38), (-1.08, 0.76, 1.2))):
        for sector in range(8):
            add_annular_sector(
                f"Deploy_AxialChannelCollar_{collar_index:02d}_Sector_{sector:02d}",
                inner,
                outer,
                math.tau * sector / 8 + 0.04,
                math.tau * (sector + 1) / 8 - 0.04,
                0.34 if collar_index else 0.5,
                y,
                mats["carbon" if (sector + collar_index) % 2 else "titanium"],
                parent=docks,
                steps=3,
                bevel_width=0.05,
            )
    for rail_index, (x, z) in enumerate(((-1.22, -0.62), (1.22, -0.62), (-1.22, 0.62), (1.22, 0.62))):
        add_box(
            f"Deploy_AxialLaneRail_{rail_index:02d}",
            (0.13, 3.15, 0.13),
            (x, -2.22, z),
            mats["orange_dim" if rail_index == 1 else "nickel"],
            parent=docks,
            bevel=0.022,
        )
    for pole in (-1, 1):
        add_cylinder(f"Deploy_PolarUplink_{pole}", 0.42, 1.8, (0, 0, pole * 4.0), mats["steel"], parent=hi, vertices=20, bevel=0.05)
        add_torus(f"Deploy_PolarAntenna_{pole}", 0.78, 0.08, (0, 0, pole * 4.88), mats["orange_dim"], parent=hi, major_segments=32, minor_segments=6)
    launch_frame = add_empty("Deploy_OrbitalLaunchFrame", parent=docks)
    pylon_profile = ((-0.62, -0.46), (0.28, -0.62), (0.68, -0.22), (0.62, 0.48), (0.2, 0.76), (-0.52, 0.62), (-0.74, 0.08))
    for pylon in range(6):
        theta = math.tau * pylon / 6
        centre = Vector((math.cos(theta) * 4.92, 0, math.sin(theta) * 4.92))
        add_extruded_profile(
            f"Deploy_LaunchPylon_{pylon:02d}",
            pylon_profile,
            0.88,
            centre,
            mats["carbon" if pylon % 2 else "titanium"],
            parent=launch_frame,
            rotation=(0, theta, 0),
            bevel=0.08,
        )
        add_cylinder_between(
            f"Deploy_LaunchPylonTruss_{pylon:02d}",
            centre * 0.68,
            centre * 0.91,
            0.14,
            mats["nickel"],
            parent=launch_frame,
            vertices=14,
        )
        add_bearing_stack(
            f"Deploy_LaunchPylonCoupler_{pylon:02d}",
            (centre.x * 0.9, -0.48, centre.z * 0.9),
            Vector((0, -1, 0)),
            mats,
            parent=launch_frame,
            radius=0.22,
            depth=0.42,
            signal=pylon == 0,
        )
    deploy_face_profile = ((-1.34, -0.58), (-0.74, -1.14), (0.74, -1.14), (1.34, -0.58), (1.34, 0.58), (0.74, 1.14), (-0.74, 1.14), (-1.34, 0.58))
    # Keep legacy node names, but make the release nexus an open segmented
    # collar instead of a solid plate blocking the deployment lane.
    for layer, (inner, outer, depth, y) in enumerate(((1.08, 1.64, 0.54, -3.62), (1.18, 1.5, 0.64, -3.88))):
        for sector in range(8):
            nexus_name = (
                "Deploy_ReleaseNexus" if layer == 0 and sector == 0
                else "Deploy_ReleaseNexusFace" if layer == 1 and sector == 0
                else f"Deploy_ReleaseNexus_{'Rear' if layer == 0 else 'Face'}Sector_{sector:02d}"
            )
            add_annular_sector(
                nexus_name,
                inner,
                outer,
                math.tau * sector / 8 + 0.035,
                math.tau * (sector + 1) / 8 - 0.035,
                depth,
                y,
                mats["carbon" if layer == 0 else ("titanium" if sector % 2 else "nickel")],
                parent=hi,
                steps=3,
                bevel_width=0.055,
            )
    for connector, (x, z) in enumerate(((-0.7, -0.48), (-0.7, 0.48), (0.7, -0.48), (0.7, 0.48))):
        add_bearing_stack(
            f"Deploy_ReleaseConnector_{connector}",
            (x, -4.18, z),
            Vector((0, -1, 0)),
            mats,
            parent=hi,
            radius=0.14,
            depth=0.28,
            signal=connector == 2,
        )
    keyframe_cycle(docks, peak_scale=(1.18, 1.18, 1.0), peak_rotation=(0, 0, math.radians(9)), action_name="SIGNATURE_DEPLOY_DOCKS_7S")

    add_ico("Deploy_MID_Core", 2.28, (0, 0, 0), mats["gunmetal"], parent=mid, subdivisions=2)
    add_structural_cage("Deploy_MID", mid, 1.5, 3.28, mats, ring_minor=0.19, strut_count=8, ring_count=2)
    add_segmented_armour_shell(
        "Deploy_MID",
        mid,
        3.48,
        mats,
        bands=3,
        segments=10,
        thickness=0.21,
        skip={(0, 2), (1, 5), (2, 8)},
        material_cycle=("carbon", "gunmetal", "titanium"),
        fastener_stride=4,
        tile_theta_segments=3,
        tile_phi_segments=3,
    )
    add_torus("Deploy_MID_Dock", 4.15, 0.3, (0, 0, 0), mats["steel"], parent=mid, major_segments=36, minor_segments=7)
    add_torus("Deploy_MID_SignalRail", 4.19, 0.055, (0, 0, 0), mats["orange_dim"], parent=mid, major_segments=36, minor_segments=5)
    for i in range(12):
        n = radial_vector(i, 12)
        add_box(f"Deploy_MID_Arm_{i}", (0.54, 1.45, 0.52), n * 4.38, mats["gunmetal" if i % 3 else "warm"], parent=mid, rotation=(0, 0, i * math.tau / 12 + math.pi / 2))
        add_cylinder_between(f"Deploy_MID_ArmSupport_{i}", n * 3.18, n * 4.15, 0.11, mats["steel"], parent=mid, vertices=12)
    for sector in range(8):
        add_annular_sector(
            "Deploy_MID_ReleaseNexus" if sector == 0 else f"Deploy_MID_ReleaseNexusSector_{sector:02d}",
            1.04,
            1.58,
            math.tau * sector / 8 + 0.04,
            math.tau * (sector + 1) / 8 - 0.04,
            0.48,
            -3.52,
            mats["titanium" if sector % 2 else "carbon"],
            parent=mid,
            steps=3,
            bevel_width=0.05,
        )
    # Balanced preserves both rack cliffs and the open axial canyon.
    for cliff_index, sign in enumerate((-1, 1)):
        cliff_x = sign * 2.92
        add_extruded_profile(
            f"Deploy_MID_RackCliff_{cliff_index:02d}",
            tuple((x * 0.9, z * 0.92) for x, z in rack_cliff_profile),
            1.86,
            (cliff_x, -0.46, 0),
            mats["carbon" if sign < 0 else "titanium"],
            parent=mid,
            rotation=(0, 0, math.pi if sign > 0 else 0),
            bevel=0.1,
        )
        for tier, z in enumerate((-1.55, -0.5, 0.55, 1.6)):
            add_box(
                f"Deploy_MID_RackBay_{cliff_index:02d}_{tier:02d}",
                (0.98, 0.28, 0.68),
                (cliff_x, -1.82, z),
                mats["gunmetal" if tier % 2 else "carbon"],
                parent=mid,
                bevel=0.05,
            )
        for rib_index, z in enumerate((-1.65, 0, 1.65)):
            add_cylinder_between(
                f"Deploy_MID_RackLoadRib_{cliff_index:02d}_{rib_index:02d}",
                Vector((sign * 1.32, 0.32, z * 0.5)),
                Vector((cliff_x - sign * 0.18, -0.2, z)),
                0.135,
                mats["titanium"],
                parent=mid,
                vertices=12,
            )
    for collar_index, (y, inner, outer) in enumerate(((-3.46, 1.08, 1.62), (-2.34, 0.92, 1.42), (-1.28, 0.78, 1.22))):
        for sector in range(8):
            add_annular_sector(
                f"Deploy_MID_AxialChannel_{collar_index:02d}_{sector:02d}",
                inner,
                outer,
                math.tau * sector / 8 + 0.045,
                math.tau * (sector + 1) / 8 - 0.045,
                0.34,
                y,
                mats["carbon" if (sector + collar_index) % 2 else "titanium"],
                parent=mid,
                steps=3,
                bevel_width=0.045,
            )
    for rail_index, (x, z) in enumerate(((-1.16, -0.58), (1.16, -0.58), (-1.16, 0.58), (1.16, 0.58))):
        add_box(
            f"Deploy_MID_AxialLaneRail_{rail_index:02d}",
            (0.12, 2.82, 0.12),
            (x, -2.06, z),
            mats["orange_dim" if rail_index == 1 else "nickel"],
            parent=mid,
            bevel=0.02,
        )
    for pylon in range(4):
        theta = math.tau * pylon / 4
        add_extruded_profile(
            f"Deploy_MID_LaunchPylon_{pylon:02d}",
            pylon_profile,
            0.72,
            (math.cos(theta) * 4.68, 0, math.sin(theta) * 4.68),
            mats["carbon" if pylon % 2 else "titanium"],
            parent=mid,
            rotation=(0, theta, 0),
            bevel=0.07,
        )
    add_ico("Deploy_LOW_Silhouette", 3.7, (0, 0, 0), mats["graphite"], parent=low, subdivisions=2)
    add_torus("Deploy_LOW_Belt", 4.2, 0.42, (0, 0, 0), mats["steel"], parent=low, major_segments=28, minor_segments=6)
    return root


def build_protect(meta, parent, mats):
    root, hi, mid, low = asset_root(
        "Planet_protect_ROOT",
        parent=parent,
        loc=planet_position(meta),
        asset_id="protect",
        service=meta["service"],
        radius=meta["radius"],
        signature=meta["signature"],
    )
    root["code"] = meta["code"]

    # PROTECT is a single armoured governance citadel, not six objects arranged
    # around a sphere.  A deep pressure hull carries the front armour, perimeter
    # walls and rear service mass; the six bastions are only reinforced corners
    # in that continuous load path.
    fortress_outline = (
        (-2.3, -3.12), (-3.16, -2.28), (-3.55, -0.82), (-3.42, 1.52),
        (-2.5, 2.92), (-0.72, 3.46), (1.48, 3.28), (2.86, 2.46),
        (3.48, 0.72), (3.34, -1.62), (2.18, -3.02), (0.35, -3.48),
    )
    rear_outline = tuple((x * 0.9, z * 0.9) for x, z in fortress_outline)
    front_outline = tuple((x * 0.96, z * 0.96) for x, z in fortress_outline)
    add_extruded_profile(
        "Protect_SolidCitadelCore", fortress_outline, 4.45, (0, 0.22, 0),
        mats["carbon"], parent=hi, bevel=0.18,
    )
    add_extruded_profile(
        "Protect_RearPressureHull", rear_outline, 1.72, (0, 2.34, 0),
        mats["gunmetal"], parent=hi, bevel=0.15,
    )
    add_extruded_profile(
        "Protect_FrontArmourBed", front_outline, 0.56, (0, -2.18, 0),
        mats["ceramic_dark"], parent=hi, bevel=0.11,
    )
    add_ico(
        "Protect_GovernancePressureCore", 1.72, (0, 0.36, 0), mats["steel"],
        parent=hi, subdivisions=2, scale=(1.08, 1.42, 1.08), smooth=False,
    )

    structure = add_empty("Protect_ContinuousFortification", parent=hi)
    signature = add_empty("Protect_SIGNATURE_ACTION", parent=hi)
    perimeter_points = [
        Vector((math.cos(math.tau * i / 6 + math.pi / 6) * 3.15, 0.0,
                math.sin(math.tau * i / 6 + math.pi / 6) * 3.15))
        for i in range(6)
    ]
    wall_profile_template = ((-1.38, -0.5), (1.38, -0.5), (1.52, -0.18), (1.42, 0.5), (-1.42, 0.5), (-1.52, -0.18))
    bastion_profile = (
        (-0.92, -0.88), (0.68, -0.96), (1.02, -0.52), (1.04, 0.52),
        (0.62, 0.96), (-0.72, 0.9), (-1.02, 0.42), (-1.04, -0.42),
    )

    # Six long walls share the full front-to-rear depth of the hull.  Their
    # layered end faces preserve panel separation without creating six petals.
    for wall_index, start in enumerate(perimeter_points):
        end = perimeter_points[(wall_index + 1) % 6]
        direction = end - start
        tangent = direction.normalized()
        midpoint = (start + end) * 0.5
        wall_rotation = -math.atan2(direction.z, direction.x)
        add_extruded_profile(
            f"Protect_CitadelWall_{wall_index:02d}", wall_profile_template, 3.72,
            midpoint + Vector((0, 0.18, 0)), mats["carbon" if wall_index % 2 else "titanium"],
            parent=structure, rotation=(0, wall_rotation, 0), bevel=0.12,
        )
        add_extruded_profile(
            f"Protect_CitadelWallFace_{wall_index:02d}",
            tuple((x * 0.92, z * 0.72) for x, z in wall_profile_template), 0.32,
            midpoint + Vector((0, -2.05, 0)), mats["nickel" if wall_index % 2 else "gunmetal"],
            parent=structure, rotation=(0, wall_rotation, 0), bevel=0.055,
        )
        # Two inset plates and a recessed vent make the face read as serviced
        # armour rather than a decorative rim.
        for panel_index, offset in enumerate((-0.62, 0.62)):
            centre = midpoint + tangent * offset + Vector((0, -2.25, 0))
            add_box(
                f"Protect_WallArmourPanel_{wall_index:02d}_{panel_index}",
                (0.94, 0.12, 0.62), centre,
                mats["ceramic_dark" if (wall_index + panel_index) % 2 else "titanium"],
                parent=structure, rotation=(0, wall_rotation, 0), bevel=0.045,
            )
            for fastener_index, fastener_offset in enumerate((-0.31, 0.31)):
                fastener_pos = centre + tangent * fastener_offset
                add_cylinder(
                    f"Protect_WallFastener_{wall_index:02d}_{panel_index}_{fastener_index}",
                    0.055, 0.11, fastener_pos + Vector((0, -0.1, 0)), mats["nickel"],
                    parent=structure, rotation=(math.pi / 2, 0, 0), vertices=10, bevel=0.012,
                )
        vent_centre = midpoint + Vector((0, -2.34, 0))
        for vent_index in range(4):
            add_box(
                f"Protect_EmbeddedVent_{wall_index:02d}_{vent_index}",
                (0.54, 0.09, 0.055), vent_centre + Vector((0, 0, (vent_index - 1.5) * 0.12)),
                mats["ink"], parent=structure, rotation=(0, wall_rotation, 0), bevel=0.012,
            )

    # Corner bastions overlap both neighbouring walls.  Thick bodies, crown
    # armour, load ribs and real bearings make them structural nodes rather
    # than hinged petals.
    for bastion_index, centre in enumerate(perimeter_points):
        theta = math.tau * bastion_index / 6 + math.pi / 6
        normal = Vector((math.cos(theta), 0, math.sin(theta)))
        tangent = Vector((-math.sin(theta), 0, math.cos(theta)))
        add_extruded_profile(
            f"Protect_ShieldBastion_{bastion_index:02d}", bastion_profile, 4.06,
            centre + Vector((0, 0.2, 0)), mats["titanium" if bastion_index % 2 == 0 else "carbon"],
            parent=structure, rotation=(0, theta, 0), bevel=0.14,
        )
        add_extruded_profile(
            f"Protect_ShieldBastionFace_{bastion_index:02d}",
            tuple((x * 0.74, z * 0.76) for x, z in bastion_profile), 0.42,
            centre + Vector((0, -2.12, 0)), mats["gunmetal" if bastion_index % 2 else "ceramic_dark"],
            parent=structure, rotation=(0, theta, 0), bevel=0.075,
        )
        add_box(
            f"Protect_BastionCrown_{bastion_index:02d}", (1.2, 0.52, 0.4),
            centre + normal * 0.18 + Vector((0, -1.68, 0.52)), mats["nickel"],
            parent=structure, rotation=(0, theta, 0), bevel=0.07,
        )
        hinge_centre = normal * 2.58 + Vector((0, -1.64, 0))
        add_bearing_stack(
            f"Protect_ShieldLoadHinge_{bastion_index:02d}", hinge_centre, tangent, mats,
            parent=structure, radius=0.29, depth=0.76, signal=False,
        )
        for brace_index, side in enumerate((-1, 1)):
            add_cylinder_between(
                f"Protect_BastionLoadRib_{bastion_index:02d}_{brace_index}",
                normal * 1.34 + tangent * side * 0.42 + Vector((0, 0.9, 0)),
                normal * 3.0 + tangent * side * 0.34 + Vector((0, -1.26, 0)),
                0.14, mats["nickel" if brace_index else "titanium"], parent=structure, vertices=12,
            )
        for latch_index, side in enumerate((-1, 1)):
            latch_pos = centre + tangent * side * 0.5 + Vector((0, -2.39, 0))
            add_box(
                f"Protect_BastionLatch_{bastion_index:02d}_{latch_index}",
                (0.28, 0.16, 0.52), latch_pos, mats["steel"], parent=structure,
                rotation=(0, theta, 0), bevel=0.035,
            )

    # The lock tunnel is the only radial composition: four stepped decagonal
    # collars project from the continuous face, framing a cold audit endpoint.
    # The tunnel rails and locking jaws explain how the shield load reaches the
    # central governance core.
    lock = add_empty("Protect_LockCore", parent=hi)
    for collar_index, (y, inner_radius, outer_radius) in enumerate(
        ((-3.82, 0.98, 1.86), (-3.25, 0.8, 1.58), (-2.7, 0.63, 1.3), (-2.18, 0.48, 1.04))
    ):
        for sector in range(10):
            add_annular_sector(
                f"Protect_LockCollar_{collar_index}_{sector:02d}",
                inner_radius, outer_radius,
                math.tau * sector / 10 + 0.026,
                math.tau * (sector + 1) / 10 - 0.026,
                0.32, y,
                mats["carbon" if (collar_index + sector) % 3 else "titanium"],
                parent=lock, steps=3, bevel_width=0.045,
            )
    for rail_index, theta in enumerate((math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4)):
        radial = Vector((math.cos(theta), 0, math.sin(theta)))
        add_cylinder_between(
            f"Protect_LockTunnelRail_{rail_index}",
            radial * 1.46 + Vector((0, -3.86, 0)),
            radial * 0.78 + Vector((0, -2.05, 0)),
            0.105, mats["nickel"], parent=lock, vertices=12,
        )
        add_bearing_stack(
            f"Protect_AuditInterlock_{rail_index}",
            radial * 1.52 + Vector((0, -3.98, 0)), Vector((0, -1, 0)), mats,
            parent=lock, radius=0.17, depth=0.34, signal=False,
        )

    lock_profile = (
        (-0.84, -0.36), (-0.58, -0.7), (-0.18, -0.88), (0.42, -0.78),
        (0.82, -0.38), (0.84, 0.36), (0.56, 0.72), (0.12, 0.88),
        (-0.46, 0.76), (-0.84, 0.34),
    )
    add_extruded_profile(
        "Protect_LockRearHousing", lock_profile, 0.76, (0, -1.68, 0),
        mats["gunmetal"], parent=lock, bevel=0.1,
    )
    add_extruded_profile(
        "Protect_LockHousing", tuple((x * 0.62, z * 0.62) for x, z in lock_profile),
        0.78, (0, -2.08, 0), mats["steel"], parent=lock, bevel=0.075,
    )
    add_ico(
        "Protect_AuditCore", 0.38, (0, -2.54, 0), mats["optical_blue"],
        parent=lock, subdivisions=2, scale=(1.0, 0.42, 1.0), smooth=False,
    )
    add_box(
        "Protect_LockCoreSignalSlit", (0.055, 0.06, 0.56),
        (0.38, -2.78, 0), mats["orange_dim"], parent=lock, bevel=0.01,
    )
    add_box(
        "Protect_AuditSignalSeam", (0.38, 0.055, 0.045),
        (-0.08, -2.79, -0.38), mats["orange_dim"], parent=lock, bevel=0.01,
    )

    # Four lock jaws move radially across the mouth.  The fortress itself never
    # collapses or blooms, so the action reads as an engineered interlock.
    jaw_specs = (
        ("N", Vector((0, -3.98, 1.3)), Vector((0, -3.98, 1.08)), (0.72, 0.28, 0.34)),
        ("S", Vector((0, -3.98, -1.3)), Vector((0, -3.98, -1.08)), (0.72, 0.28, 0.34)),
        ("E", Vector((1.3, -3.98, 0)), Vector((1.08, -3.98, 0)), (0.34, 0.28, 0.72)),
        ("W", Vector((-1.3, -3.98, 0)), Vector((-1.08, -3.98, 0)), (0.34, 0.28, 0.72)),
    )
    for jaw_index, (jaw_id, start, peak, dims) in enumerate(jaw_specs):
        jaw = add_empty(f"Protect_LockJaw_{jaw_id}_ACTION", parent=signature, loc=start)
        add_box(
            f"Protect_LockJaw_{jaw_id}", dims, (0, 0, 0),
            mats["titanium" if jaw_index % 2 else "nickel"], parent=jaw, bevel=0.055,
        )
        keyframe_cycle(
            jaw, peak_location=peak,
            action_name=f"SIGNATURE_PROTECT_LOCK_JAW_{jaw_id}_7S",
        )
    keyframe_cycle(
        signature, peak_rotation=(0, math.radians(6), 0),
        action_name="SIGNATURE_PROTECT_ECLIPSE_7S",
    )

    # Balanced retains the same deep, continuous fortress silhouette with a
    # reduced panel vocabulary and the same readable lock tunnel.
    add_extruded_profile(
        "Protect_MID_SolidCitadelCore", tuple((x * 0.95, z * 0.95) for x, z in fortress_outline),
        4.0, (0, 0.2, 0), mats["carbon"], parent=mid, bevel=0.17,
    )
    add_extruded_profile(
        "Protect_MID_RearPressureHull", tuple((x * 0.84, z * 0.84) for x, z in fortress_outline),
        1.5, (0, 2.12, 0), mats["gunmetal"], parent=mid, bevel=0.13,
    )
    mid_structure = add_empty("Protect_MID_ContinuousFortification", parent=mid)
    mid_points = [point * 0.95 for point in perimeter_points]
    for wall_index, start in enumerate(mid_points):
        end = mid_points[(wall_index + 1) % 6]
        direction = end - start
        midpoint = (start + end) * 0.5
        rotation = -math.atan2(direction.z, direction.x)
        add_extruded_profile(
            f"Protect_MID_CitadelWall_{wall_index:02d}",
            tuple((x * 0.93, z * 0.9) for x, z in wall_profile_template),
            3.35, midpoint + Vector((0, 0.18, 0)),
            mats["carbon" if wall_index % 2 else "titanium"], parent=mid_structure,
            rotation=(0, rotation, 0), bevel=0.105,
        )
        theta = math.tau * wall_index / 6 + math.pi / 6
        add_extruded_profile(
            f"Protect_MID_ShieldBastion_{wall_index:02d}",
            tuple((x * 0.82, z * 0.82) for x, z in bastion_profile), 3.55,
            start + Vector((0, 0.18, 0)), mats["gunmetal" if wall_index % 2 else "titanium"],
            parent=mid_structure, rotation=(0, theta, 0), bevel=0.115,
        )
        add_bearing_stack(
            f"Protect_MID_ShieldLoadHinge_{wall_index:02d}",
            Vector((math.cos(theta) * 2.42, -1.45, math.sin(theta) * 2.42)),
            Vector((-math.sin(theta), 0, math.cos(theta))), mats,
            parent=mid_structure, radius=0.24, depth=0.58, signal=False,
        )
    mid_lock = add_empty("Protect_MID_LockCore", parent=mid)
    for collar_index, (y, inner_radius, outer_radius) in enumerate(
        ((-3.42, 0.9, 1.62), (-2.74, 0.68, 1.3), (-2.08, 0.48, 0.98))
    ):
        for sector in range(8):
            add_annular_sector(
                f"Protect_MID_LockCollar_{collar_index}_{sector:02d}",
                inner_radius, outer_radius,
                math.tau * sector / 8 + 0.03,
                math.tau * (sector + 1) / 8 - 0.03,
                0.3, y, mats["carbon" if (collar_index + sector) % 2 else "titanium"],
                parent=mid_lock, steps=3, bevel_width=0.04,
            )
    add_extruded_profile(
        "Protect_MID_LockHousing", tuple((x * 0.62, z * 0.62) for x, z in lock_profile),
        0.68, (0, -1.82, 0), mats["steel"], parent=mid_lock, bevel=0.08,
    )
    add_ico(
        "Protect_MID_AuditCore", 0.34, (0, -2.18, 0), mats["optical_blue"],
        parent=mid_lock, subdivisions=2, scale=(1.0, 0.45, 1.0), smooth=False,
    )
    add_box(
        "Protect_MID_AuditSignalSeam", (0.05, 0.055, 0.46),
        (0.34, -2.42, 0), mats["orange_dim"], parent=mid_lock, bevel=0.01,
    )

    # Balanced preserves the same engineered interlock behaviour as Ultra.
    # These four cheap internal jaws are preferable to animating the complete
    # LOD root: the fortress remains a credible load-bearing mass while the
    # lock mechanism visibly closes and re-opens in a perfectly reversible
    # seven-second action.
    mid_signature = add_empty("Protect_MID_SIGNATURE_ACTION", parent=mid)
    mid_jaw_specs = (
        ("N", Vector((0, -3.52, 1.12)), Vector((0, -3.52, 0.94)), (0.62, 0.24, 0.3)),
        ("S", Vector((0, -3.52, -1.12)), Vector((0, -3.52, -0.94)), (0.62, 0.24, 0.3)),
        ("E", Vector((1.12, -3.52, 0)), Vector((0.94, -3.52, 0)), (0.3, 0.24, 0.62)),
        ("W", Vector((-1.12, -3.52, 0)), Vector((-0.94, -3.52, 0)), (0.3, 0.24, 0.62)),
    )
    for jaw_index, (jaw_id, start, peak, dims) in enumerate(mid_jaw_specs):
        jaw = add_empty(f"Protect_MID_LockJaw_{jaw_id}_ACTION", parent=mid_signature, loc=start)
        add_box(
            f"Protect_MID_LockJaw_{jaw_id}", dims, (0, 0, 0),
            mats["titanium" if jaw_index % 2 else "nickel"], parent=jaw, bevel=0.05,
        )
        keyframe_cycle(
            jaw, peak_location=peak,
            action_name=f"SIGNATURE_PROTECT_MID_LOCK_JAW_{jaw_id}_7S",
        )

    add_extruded_profile(
        "Protect_LOW_Silhouette", tuple((x * 0.98, z * 0.98) for x, z in fortress_outline),
        3.72, (0, 0.14, 0), mats["ink"], parent=low, bevel=0.16,
    )
    add_torus(
        "Protect_LOW_LockMouth", 1.15, 0.24, (0, -2.0, 0), mats["steel"],
        parent=low, rotation=(math.pi / 2, 0, 0), major_segments=24, minor_segments=6,
    )
    return root


def build_operate(meta, parent, mats):
    root, hi, mid, low = asset_root("Planet_operate_ROOT", parent=parent, loc=planet_position(meta), asset_id="operate", service=meta["service"], radius=meta["radius"], signature=meta["signature"])
    root["code"] = meta["code"]
    lattice = add_empty("Operate_SIGNATURE_ACTION", parent=hi)
    # Three structural gimbals establish the world scale.  Their segmented
    # rails and bearing drums are the only circular macro-forms.
    gimbal_axes: list[bpy.types.Object] = []
    for i, rotation in enumerate(((0, 0, 0), (math.pi / 2, 0, 0), (0, math.pi / 2, 0))):
        axis = add_segmented_gimbal(
            f"Operate_InferenceGimbal_{i}",
            lattice,
            3.28 + 0.4 * i,
            mats,
            rotation=rotation,
            segments=10,
            radial_width=0.42 if i < 2 else 0.36,
            depth=0.44 if i == 0 else 0.38,
            steps=6,
        )
        gimbal_axes.append(axis)
    for i, (axis, peak) in enumerate(zip(gimbal_axes, (38, -64, 112))):
        base_rotation = axis.rotation_euler.copy()
        rotation_delta = Vector((0, math.radians(peak * 0.28), math.radians(peak)))
        keyframe_cycle(
            axis,
            # Animate around the authored gimbal axis.  Supplying an absolute
            # Euler value here used to erase the second and third ring's
            # orthogonal setup at the action peak, making them snap onto the
            # same plane instead of behaving like a nested inference cage.
            peak_rotation=tuple(base_rotation[axis_index] + rotation_delta[axis_index] for axis_index in range(3)),
            action_name=f"SIGNATURE_OPERATE_GIMBAL_{i}_7S",
        )

    # Six large compute banks hang from explicit radial spines.  No random
    # relays or equal-sized molecular nodes are generated.
    compute_banks = add_empty("Operate_InferenceComputeBanks", parent=lattice)
    bank_profile = ((-0.82, -0.5), (-0.24, -0.84), (0.7, -0.72), (0.98, -0.14), (0.72, 0.76), (-0.18, 0.92), (-0.9, 0.44))
    bank_centres: list[Vector] = []
    for bank in range(6):
        theta = math.tau * bank / 6 + 0.16
        centre = Vector((math.cos(theta) * 3.18, -0.42 + 0.16 * (bank % 2), math.sin(theta) * 3.18))
        bank_centres.append(centre)
        add_extruded_profile(
            f"Operate_ComputeBank_{bank:02d}",
            bank_profile,
            1.08,
            centre,
            mats["carbon"],
            parent=compute_banks,
            rotation=(0, theta, 0),
            bevel=0.075,
        )
        add_extruded_profile(
            f"Operate_ComputeBankFace_{bank:02d}",
            tuple((x * 0.68, z * 0.68) for x, z in bank_profile),
            1.2,
            centre + Vector((0, -0.1, 0)),
            mats["titanium" if bank % 2 else "ceramic_dark"],
            parent=compute_banks,
            rotation=(0, theta, 0),
            bevel=0.05,
        )
        inner = Vector((math.cos(theta) * 1.0, -0.18, math.sin(theta) * 1.0))
        add_cylinder_between(
            f"Operate_ComputeBankSpine_{bank:02d}",
            Vector((inner.x, 0.18, inner.z)),
            Vector((centre.x * 0.82, centre.y + 0.3, centre.z * 0.82)),
            0.17,
            mats["nickel"],
            parent=compute_banks,
            vertices=14,
        )
        bearing_centre = Vector((math.cos(theta) * 2.36, -0.5, math.sin(theta) * 2.36))
        add_bearing_stack(
            f"Operate_ComputeBankBearing_{bank:02d}",
            bearing_centre,
            Vector((0, -1, 0)),
            mats,
            parent=compute_banks,
            radius=0.2,
            depth=0.4,
            signal=False,
        )

    # Deep optical processor: carbon load housing, titanium collar and glass
    # window reveal depth; the orange key is a narrow internal causal path, not
    # a glowing red button.
    processor_profile = ((-0.72, -0.28), (-0.34, -0.68), (0.34, -0.68), (0.72, -0.28), (0.72, 0.28), (0.34, 0.68), (-0.34, 0.68), (-0.72, 0.28))
    add_extruded_profile("Operate_CausalKernel", tuple((x * 1.55, z * 1.55) for x, z in processor_profile), 1.42, (0, 0.18, 0), mats["carbon"], parent=lattice, bevel=0.1)
    add_extruded_profile("Operate_CausalProcessorCollar", tuple((x * 1.08, z * 1.08) for x, z in processor_profile), 1.58, (0, -0.03, 0), mats["titanium"], parent=lattice, bevel=0.075)
    add_extruded_profile(
        "Operate_CausalProcessorFace",
        tuple((x * 0.72, z * 0.72) for x, z in processor_profile),
        1.7,
        (0, -0.18, 0),
        mats["optical_blue"],
        parent=lattice,
        bevel=0.055,
    )
    add_box("Operate_KernelSignal", (0.055, 0.1, 0.62), (0, -1.06, 0), mats["orange_dim"], parent=lattice, bevel=0.01)

    # Fifteen routed service nodes sit on three deliberate buses.  Each bus
    # feeds exactly two compute banks and terminates at the processor.
    bus_rows = (
        tuple(Vector((-2.2 + index * 1.1, -1.08, -1.5)) for index in range(5)),
        tuple(Vector((-2.2 + index * 1.1, -1.16, 0.0)) for index in range(5)),
        tuple(Vector((-2.2 + index * 1.1, -1.08, 1.5)) for index in range(5)),
    )
    node_counter = 0
    for bus_index, row in enumerate(bus_rows):
        for node_index, point in enumerate(row):
            add_box(
                f"Operate_Node_{node_counter:02d}",
                (0.34 if node_index in (0, 4) else 0.26, 0.28, 0.22),
                point,
                mats["ceramic" if node_index in (0, 4) else "titanium"],
                parent=lattice,
                bevel=0.045,
            )
            if node_index:
                add_cylinder_between(
                    f"Operate_CausalLink_{bus_index}_{node_index - 1}", row[node_index - 1], point, 0.075,
                    mats["orange_dim" if node_index == 3 else "nickel"], parent=lattice, vertices=12
                )
            node_counter += 1
        add_cylinder_between(f"Operate_BusFeed_{bus_index}_A", row[0], bank_centres[bus_index * 2] * 0.84, 0.095, mats["nickel"], parent=lattice, vertices=12)
        add_cylinder_between(f"Operate_BusFeed_{bus_index}_B", row[-1], bank_centres[bus_index * 2 + 1] * 0.84, 0.095, mats["nickel"], parent=lattice, vertices=12)
    keyframe_cycle(lattice, peak_rotation=(math.radians(38), math.radians(72), math.radians(118)), peak_scale=(1.06, 1.06, 1.06), action_name="SIGNATURE_OPERATE_INFERENCE_7S")

    mid_lattice = add_empty("Operate_MID_SIGNATURE_ACTION", parent=mid)
    mid_axes: list[bpy.types.Object] = []
    for i, rotation in enumerate(((0, 0, 0), (math.pi / 2, 0, 0), (0, math.pi / 2, 0))):
        axis = add_segmented_gimbal(
            f"Operate_MID_Gimbal_{i}",
            mid_lattice,
            3.16 + 0.36 * i,
            mats,
            rotation=rotation,
            segments=8,
            radial_width=0.36 if i < 2 else 0.32,
            depth=0.34,
            steps=4,
        )
        mid_axes.append(axis)
    for i, (axis, peak) in enumerate(zip(mid_axes, (30, -48, 86))):
        base_rotation = axis.rotation_euler.copy()
        rotation_delta = Vector((0, math.radians(peak * 0.22), math.radians(peak)))
        keyframe_cycle(
            axis,
            peak_rotation=tuple(base_rotation[axis_index] + rotation_delta[axis_index] for axis_index in range(3)),
            action_name=f"SIGNATURE_OPERATE_MID_GIMBAL_{i}_7S",
        )
    add_extruded_profile("Operate_MID_Processor", tuple((x * 1.35, z * 1.35) for x, z in processor_profile), 1.3, (0, 0, 0), mats["optical_blue"], parent=mid_lattice, bevel=0.09)
    mid_bank_centres: list[Vector] = []
    for bank in range(6):
        theta = math.tau * bank / 6 + 0.2
        centre = Vector((math.cos(theta) * 3.02, -0.28, math.sin(theta) * 3.02))
        mid_bank_centres.append(centre)
        add_extruded_profile(
            f"Operate_MID_ComputeBank_{bank:02d}",
            tuple((x * 0.88, z * 0.88) for x, z in bank_profile),
            0.88,
            centre,
            mats["carbon" if bank % 2 else "titanium"],
            parent=mid_lattice,
            rotation=(0, theta, 0),
            bevel=0.065,
        )
        add_cylinder_between(f"Operate_MID_BankSpine_{bank:02d}", Vector((math.cos(theta), 0.15, math.sin(theta))), centre * 0.82, 0.14, mats["nickel"], parent=mid_lattice, vertices=12)
    for bus_index, z in enumerate((-1.28, 0.0, 1.28)):
        row = tuple(Vector((-1.8 + index * 1.2, -0.92, z)) for index in range(4))
        for node_index, point in enumerate(row):
            add_box(f"Operate_MID_Node_{bus_index}_{node_index}", (0.28, 0.24, 0.2), point, mats["ceramic" if node_index in (0, 3) else "titanium"], parent=mid_lattice, bevel=0.04)
            if node_index:
                add_cylinder_between(f"Operate_MID_CausalLink_{bus_index}_{node_index}", row[node_index - 1], point, 0.07, mats["orange_dim" if node_index == 2 else "nickel"], parent=mid_lattice, vertices=10)
    add_torus("Operate_LOW_Gimbal_A", 3.35, 0.18, (0, 0, 0), mats["steel"], parent=low, rotation=(math.pi / 2, 0, 0), major_segments=24, minor_segments=5)
    add_torus("Operate_LOW_Gimbal_B", 3.65, 0.14, (0, 0, 0), mats["titanium"], parent=low, rotation=(0, math.pi / 2, 0), major_segments=24, minor_segments=5)
    add_ico("Operate_LOW_Kernel", 1.2, (0, 0, 0), mats["optical_blue"], parent=low, subdivisions=2)
    return root


def planet_position(meta) -> tuple[float, float, float]:
    theta = math.radians(meta["angle"])
    return (
        math.cos(theta) * meta["orbitRadius"],
        math.sin(theta) * meta["orbitRadius"],
        meta["z"],
    )


def build_system_infrastructure(system_root, mats):
    infra = add_empty("OrbitInfrastructure_ROOT", parent=system_root)
    infra["animationOwner"] = "Three.js / GSAP"
    for i, meta in enumerate(PLANETS):
        radius = meta["orbitRadius"]
        add_torus(f"IndustrialOrbit_{i + 1:02d}", radius, 0.035 if i % 2 else 0.055, (0, 0, 0), mats["steel" if i % 3 else "orange_dim"], parent=infra, major_segments=128, minor_segments=5)
        theta = math.radians(meta["angle"])
        n = Vector((math.cos(theta), math.sin(theta), 0))
        add_cylinder_between(f"OrbitConduit_{meta['code']}", n * 5.7, n * (radius - meta["radius"] - 0.8), 0.055, mats["orange_dim"], parent=infra, vertices=8)
        for lock_i, distance in enumerate((7.2, 10.4, radius - meta["radius"] - 1.3)):
            add_box(f"OrbitLock_{meta['code']}_{lock_i}", (0.28, 0.48, 0.22), n * distance, mats["gunmetal"], parent=infra, rotation=(0, 0, theta), bevel=0.035)
    # Broken concentric arcs at different pitches create architectural depth.
    for i, rotation in enumerate(((0.22, 0.0, 0.0), (-0.18, 0.0, 0.0), (0.0, 0.16, 0.0))):
        add_torus(f"ReactorServiceHalo_{i}", 6.5 + i * 1.1, 0.07, (0, 0, 0), mats["steel"], parent=infra, rotation=rotation, major_segments=80, minor_segments=6)
    return infra


def create_camera_and_lights(scene, mats):
    cam_data = bpy.data.cameras.new("OrbitRenderCamera")
    cam = bpy.data.objects.new("OrbitRenderCamera", cam_data)
    scene.collection.objects.link(cam)
    cam_data.lens = 54.0
    cam_data.sensor_width = 36.0
    cam_data.dof.use_dof = False
    scene.camera = cam

    def area(name, loc, target, color, power, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = loc
        look_at(obj, target)
        return obj

    area("Orbit Warm Key", (-16, -22, 24), (0, 0, 0), (1.0, 0.76, 0.54), 2700, 12.0)
    area("Orbit Cold Fill", (18, -10, 14), (0, 0, 0), (0.42, 0.60, 0.84), 4700, 13.0)
    area("Orbit Steel Rim", (4, 24, 26), (0, 0, 0), (0.66, 0.82, 1.0), 5100, 10.0)
    area("Orbit Low Bounce", (-5, 3, -15), (0, 0, 0), (0.32, 0.43, 0.62), 2100, 11.0)
    data = bpy.data.lights.new("Orbit Signal Point", "POINT")
    data.energy = 220
    data.color = (1.0, 0.055, 0.006)
    data.shadow_soft_size = 4.0
    point = bpy.data.objects.new("Orbit Signal Point", data)
    scene.collection.objects.link(point)
    point.location = (0, 0, 2)
    # A restrained compositor glow keeps the signal color confined to seams
    # and rails while still producing the cinematic energy response expected
    # from the approved visual direction.
    try:
        scene.use_nodes = True
        nodes = scene.node_tree.nodes
        nodes.clear()
        layers = nodes.new("CompositorNodeRLayers")
        glare = nodes.new("CompositorNodeGlare")
        glare.glare_type = "FOG_GLOW"
        glare.quality = "HIGH"
        glare.threshold = 0.8
        glare.size = 6
        glare.mix = -0.82
        composite = nodes.new("CompositorNodeComposite")
        scene.node_tree.links.new(layers.outputs["Image"], glare.inputs["Image"])
        scene.node_tree.links.new(glare.outputs["Image"], composite.inputs["Image"])
    except (AttributeError, RuntimeError, TypeError):
        pass
    return cam


def create_authored_flythrough(scene, star_root, planet_roots) -> bpy.types.Object:
    """Author a 60-second inspection camera in the Blender master.

    The browser owns runtime choreography, but this camera gives asset review a
    deterministic system reveal and a close pass at every planet without
    baking camera motion into any GLB.
    """
    data = bpy.data.cameras.new("OrbitFlythroughCamera")
    camera = bpy.data.objects.new("OrbitFlythroughCamera", data)
    scene.collection.objects.link(camera)
    data.lens = 46.0
    camera["previewDurationSeconds"] = 60
    camera["reviewOnly"] = True
    planet_order = [planet_roots[meta["id"]] for meta in PLANETS]
    shots: list[tuple[int, Vector, Vector]] = [
        (1, Vector((0, -68, 38)), Vector((2, 0, 0))),
        (150, Vector((-2, -25, 9)), star_root.matrix_world.translation.copy()),
    ]
    for sequence, root in enumerate(planet_order):
        target = root.matrix_world.translation.copy()
        side = -1 if sequence % 2 else 1
        position = target + Vector((side * (4.0 + sequence % 3), -19.0, 7.0 + (sequence % 2) * 2.0))
        shots.append((300 + sequence * 150, position, target))
    shots.append((1440, Vector((0, -72, 42)), Vector((1.5, 0, 0))))
    for frame, position, target in shots:
        camera.location = position
        look_at(camera, target)
        camera.keyframe_insert("location", frame=frame)
        camera.keyframe_insert("rotation_euler", frame=frame)
    if camera.animation_data and camera.animation_data.action:
        camera.animation_data.action.name = "PROJECT_ORBIT_FLYTHROUGH_60S"
    return camera


def create_hero_backdrop(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Create a restrained industrial depth field used only by hero renders."""
    root = add_empty("OrbitHeroBackdrop_ROOT")
    root["renderRole"] = "isolated hero depth; never exported"
    add_torus(
        "HeroBackdrop_InnerArch",
        8.6,
        0.13,
        (0, 8.5, 0),
        mats["gunmetal"],
        parent=root,
        rotation=(math.pi / 2, 0, 0),
        major_segments=96,
        minor_segments=7,
    )
    add_torus(
        "HeroBackdrop_OuterArch",
        11.4,
        0.18,
        (0, 9.0, 0),
        mats["steel"],
        parent=root,
        rotation=(math.pi / 2, 0, 0),
        major_segments=112,
        minor_segments=7,
    )
    for segment in range(20):
        theta = math.tau * segment / 20
        radial = Vector((math.cos(theta), 0, math.sin(theta)))
        plate = add_box(
            f"HeroBackdrop_ArchLock_{segment:02d}",
            (0.52, 0.82, 1.28 if segment % 4 else 1.72),
            (radial.x * 10.0, 8.7, radial.z * 10.0),
            mats["graphite" if segment % 3 else "warm"],
            parent=root,
            bevel=0.065,
        )
        orient_z_to(plate, radial)
    for side in (-1, 1):
        add_box(
            f"HeroBackdrop_Pylon_{'L' if side < 0 else 'R'}",
            (1.15, 1.8, 14.5),
            (side * 11.8, 9.8, -0.8),
            mats["graphite"],
            parent=root,
            bevel=0.11,
        )
        for level, z in enumerate((-4.8, -1.6, 1.6, 4.8)):
            add_box(
                f"HeroBackdrop_PylonInterface_{side}_{level}",
                (1.65, 0.36, 0.42),
                (side * 11.8, 8.75, z),
                mats["orange_dim" if side < 0 and level == 0 else "steel"],
                parent=root,
                bevel=0.045,
            )
    for level, z in enumerate((-5.6, 5.6)):
        add_box(
            f"HeroBackdrop_ServiceRail_{level}",
            (19.0, 0.18, 0.12),
            (0, 10.0, z),
            mats["steel"],
            parent=root,
            bevel=0.025,
        )
    # Mid-distance truss and machinery silhouettes create readable layers
    # without competing with the selected planet.
    truss_points = [
        (Vector((-10.0, 11.0, -6.2)), Vector((10.0, 11.0, 6.2))),
        (Vector((-10.0, 11.2, 6.2)), Vector((10.0, 11.2, -6.2))),
        (Vector((-9.0, 10.8, -6.6)), Vector((-3.2, 10.8, 6.6))),
        (Vector((9.0, 10.8, -6.6)), Vector((3.2, 10.8, 6.6))),
    ]
    for index, (start, end) in enumerate(truss_points):
        add_cylinder_between(
            f"HeroBackdrop_Truss_{index:02d}",
            start,
            end,
            0.085,
            mats["gunmetal" if index % 2 else "steel"],
            parent=root,
            vertices=10,
        )
    for side in (-1, 1):
        for level, z in enumerate((-3.6, 0.0, 3.6)):
            add_box(
                f"HeroBackdrop_MidMachinery_{side}_{level}",
                (1.7 + 0.32 * level, 1.25, 1.05 + 0.2 * (level % 2)),
                (side * (7.4 + level * 0.5), 6.2 + level * 0.65, z),
                mats["graphite" if level % 2 else "gunmetal"],
                parent=root,
                rotation=(0.08 * side, 0.12 * level, 0.05 * side),
                bevel=0.1,
            )
    # A thick foreground service rib is deliberately larger than the frame;
    # only cropped cold-grey arcs and clamps remain, providing scale.
    add_torus(
        "HeroBackdrop_ForegroundServiceRib",
        7.25,
        0.24,
        (0, -3.2, 0),
        mats["gunmetal"],
        parent=root,
        rotation=(math.pi / 2, 0, 0),
        major_segments=96,
        minor_segments=9,
    )
    for clamp in range(12):
        theta = math.tau * clamp / 12
        radial = Vector((math.cos(theta), 0, math.sin(theta)))
        plate = add_box(
            f"HeroBackdrop_ForegroundClamp_{clamp:02d}",
            (0.65, 0.8, 0.38),
            (radial.x * 7.25, -3.2, radial.z * 7.25),
            mats["steel" if clamp % 3 == 0 else "graphite"],
            parent=root,
            bevel=0.065,
        )
        orient_z_to(plate, radial)
    return root


def look_at(obj: bpy.types.Object, target: Sequence[float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def recursive_objects(root: bpy.types.Object) -> list[bpy.types.Object]:
    output = [root]
    for child in root.children:
        output.extend(recursive_objects(child))
    return output


def configure_visibility(asset_roots: Sequence[bpy.types.Object], visible_roots: Iterable[bpy.types.Object], lod: int) -> None:
    visible = set(visible_roots)
    for root in asset_roots:
        root_visible = root in visible
        root.hide_render = not root_visible
        root.hide_set(not root_visible)
        for child in root.children:
            if "_WEB_LOD" in child.name:
                index = int(child.name.rsplit("LOD", 1)[1])
                state = not (root_visible and index == lod)
                for descendant in recursive_objects(child):
                    descendant.hide_render = state
                    descendant.hide_set(state)
            elif child.name.endswith("_COLLISION") or child.name.endswith("_LABEL_ANCHOR") or child.name.endswith("_FOCUS_ANCHOR"):
                for descendant in recursive_objects(child):
                    descendant.hide_render = True
                    descendant.hide_set(True)


def set_tree_renderable(root: bpy.types.Object, visible: bool) -> None:
    for obj in recursive_objects(root):
        obj.hide_render = not visible
        obj.hide_set(not visible)


def render_acceptance_frames(scene, camera, asset_roots, star_root, planet_roots):
    RENDERS.mkdir(parents=True, exist_ok=True)
    scene.render.resolution_x = HERO_WIDTH
    scene.render.resolution_y = HERO_HEIGHT
    scene.render.resolution_percentage = int(os.environ.get("ORBIT_RENDER_PERCENT", "100"))
    scene.render.image_settings.file_format = "PNG"
    scene.frame_set(84)
    hero_camera = {
        "star": ((-1.2, -29.0, 6.8), (0, 0, 0), 54),
        "transform": ((-0.7, -29.0, 5.5), (0, 0, 0), 55),
        "build": ((-1.5, -27.0, 5.5), (0, 0, 0.2), 54),
        "experience": ((0.3, -23.0, 3.7), (0, 0, 0), 54),
        "test": ((-0.8, -27.0, 5.5), (0, 0, 0), 54),
        "deploy": ((-1.2, -31.0, 6.4), (0, 0, 0), 55),
        "protect": ((0.0, -25.5, 4.9), (0, 0, 0), 54),
        "operate": ((-0.4, -27.0, 5.8), (0, 0, 0), 54),
    }
    ordered = [("star", star_root)] + [(meta["id"], planet_roots[meta["id"]]) for meta in PLANETS]
    infrastructure = next(child for child in star_root.parent.children if child.name == "OrbitInfrastructure_ROOT")
    backdrop = bpy.data.objects["OrbitHeroBackdrop_ROOT"]
    set_tree_renderable(infrastructure, False)
    set_tree_renderable(backdrop, True)
    for asset_id, root in ordered:
        scene.frame_set(52 if asset_id == "experience" else (44 if asset_id == "protect" else 84))
        configure_visibility(asset_roots, [root], 0)
        old_loc = root.location.copy()
        root.location = (0, 0, 0)
        location, target, lens = hero_camera[asset_id]
        camera.location = location
        camera.data.lens = lens
        look_at(camera, target)
        scene.render.filepath = str(RENDERS / f"{asset_id}-hero.png")
        bpy.ops.render.render(write_still=True)
        root.location = old_loc
        print(f"RENDERED={scene.render.filepath}")

    configure_visibility(asset_roots, asset_roots, 0)
    set_tree_renderable(infrastructure, True)
    set_tree_renderable(backdrop, False)
    scene.frame_set(1)
    camera.location = (0.0, -61.0, 40.0)
    camera.data.lens = 43.0
    look_at(camera, (2.5, 1.0, 0.0))
    scene.render.filepath = str(RENDERS / "system-overview.png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED={scene.render.filepath}")


def selection_for_asset(root: bpy.types.Object, lod: int) -> list[bpy.types.Object]:
    wanted = [root]
    for child in root.children:
        if child.name.endswith(f"_WEB_LOD{lod}") or child.name.endswith("_COLLISION") or child.name.endswith("_LABEL_ANCHOR") or child.name.endswith("_FOCUS_ANCHOR"):
            wanted.extend(recursive_objects(child))
    return wanted


def export_selected(path: Path, selected: Sequence[bpy.types.Object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    hidden_state = {}
    for obj in selected:
        hidden_state[obj.name] = (obj.hide_get(), obj.hide_render, obj.hide_viewport)
        obj.hide_set(False)
        obj.hide_render = False if "_COLLISION" not in obj.name else True
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        # Three.js derives the tangent basis from position/normal/UV.  Explicit
        # tangents inflate the system GLBs and fail on some procedural caps.
        export_tangents=False,
        export_keep_originals=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_animations=True,
        export_frame_range=True,
        export_force_sampling=True,
    )
    for obj in selected:
        was_hidden, hide_render, hide_viewport = hidden_state[obj.name]
        obj.hide_set(was_hidden)
        obj.hide_render = hide_render
        obj.hide_viewport = hide_viewport


def export_asset_pair(asset_id: str, root: bpy.types.Object) -> tuple[Path, Path]:
    original_parent = root.parent
    original_location = root.location.copy()
    root.parent = None
    root.location = (0, 0, 0)
    ultra = MODELS / f"orbit-{asset_id}-ultra.glb"
    balanced = MODELS / f"orbit-{asset_id}-balanced.glb"
    export_selected(ultra, selection_for_asset(root, 0))
    export_selected(balanced, selection_for_asset(root, 1))
    root.parent = original_parent
    root.location = original_location
    return ultra, balanced


def system_selection(system_root: bpy.types.Object, asset_roots: Sequence[bpy.types.Object], lod: int):
    selected = [system_root]
    infra = next(child for child in system_root.children if child.name == "OrbitInfrastructure_ROOT")
    selected.extend(recursive_objects(infra))
    for root in asset_roots:
        selected.extend(selection_for_asset(root, lod))
    # De-duplicate while preserving hierarchy order.
    return list(dict.fromkeys(selected))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def descriptor(path: Path) -> dict[str, object]:
    return {
        "url": "/assets/orbit/" + path.relative_to(OUT).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def render_descriptor(path: Path) -> dict[str, object]:
    value = descriptor(path)
    value["width"] = HERO_WIDTH
    value["height"] = HERO_HEIGHT
    value["renderer"] = "Eevee Next"
    value["viewTransform"] = "AgX - Medium High Contrast"
    return value


def build_manifest(system_paths, star_paths, planet_paths):
    manifest = {
        "version": "1.0.0",
        "generatedBy": "tools/generate_project_orbit.py / Blender 5.1",
        "coordinateConvention": "glTF Y-up",
        "lodPolicy": {
            "ultra": "WEB_LOD0, focused desktop presentation",
            "balanced": "WEB_LOD1, unfocused/mobile presentation",
            "masterOnly": "WEB_LOD2 is retained in the Blender source for distant authoring reference",
        },
        "textureLibrary": {
            "resolution": TEXTURE_SIZE,
            "packing": "PNG, embedded into GLB; ORM uses R=AO G=roughness B=metalness",
            "tileable": True,
            "images": {
                texture_id: descriptor(TEXTURES / filename)
                for texture_id, filename in TEXTURE_FILES.items()
            },
        },
        "system": {
            "root": "OrbitSystem_ROOT",
            "ultra": descriptor(system_paths[0]),
            "balanced": descriptor(system_paths[1]),
            "flythrough": {
                "camera": "OrbitFlythroughCamera",
                "action": "PROJECT_ORBIT_FLYTHROUGH_60S",
                "durationSeconds": 60,
                "location": "Blender master",
            },
        },
        "star": {
            "id": "star",
            "root": "ReactorSun_ROOT",
            "ultra": descriptor(star_paths[0]),
            "balanced": descriptor(star_paths[1]),
            "hero": render_descriptor(RENDERS / "star-hero.png"),
        },
        "planets": [],
        "renders": {
            "systemOverview": render_descriptor(RENDERS / "system-overview.png"),
        },
        "blenderMaster": descriptor(BLEND_PATH),
    }
    for meta in PLANETS:
        paths = planet_paths[meta["id"]]
        manifest["planets"].append(
            {
                "id": meta["id"],
                "code": meta["code"],
                "service": meta["service"],
                "root": f"Planet_{meta['id']}_ROOT",
                "ultra": descriptor(paths[0]),
                "balanced": descriptor(paths[1]),
                "hero": render_descriptor(RENDERS / f"{meta['id']}-hero.png"),
                "signatureAction": meta["signature"],
                "actionDurationSeconds": ACTION_END / FPS,
                "orbitRadius": meta["orbitRadius"],
                "orbitAngleDegrees": meta["angle"],
            }
        )
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def scene_stats() -> None:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    print(
        "PROJECT_ORBIT_STATS "
        f"objects={len(bpy.context.scene.objects)} "
        f"meshes={len(meshes)} triangles_base={triangles} "
        f"materials={len(bpy.data.materials)} actions={len(bpy.data.actions)}"
    )


def attach_balanced_actions(asset_roots: Sequence[bpy.types.Object]) -> None:
    """Give every Balanced asset a cheap, reversible silhouette action.

    LOD0 moves detailed internal subassemblies.  LOD1 intentionally has far
    fewer nodes, so its authored action lives on the LOD root and preserves the
    same 7-second forward/reverse contract without duplicating dense geometry.
    """
    poses = {
        "star": ((1.08, 1.08, 1.08), (0.0, 0.0, math.radians(24))),
        "transform": ((1.08, 1.0, 1.0), (0.0, math.radians(9), math.radians(9))),
        "build": ((1.04, 1.04, 1.10), (0.0, 0.0, math.radians(10))),
        "experience": ((0.88, 1.0, 0.88), (0.0, math.radians(8), math.radians(22))),
        "test": ((1.05, 1.05, 1.05), (math.radians(28), math.radians(18), math.radians(45))),
        "deploy": ((1.13, 1.13, 1.0), (0.0, 0.0, math.radians(8))),
        "protect": ((0.88, 0.88, 0.88), (math.radians(8), math.radians(12), math.radians(10))),
        "operate": ((1.06, 1.06, 1.06), (math.radians(34), math.radians(60), math.radians(90))),
    }
    for root in asset_roots:
        asset_id = root.get("orbitAsset")
        lod1 = next(child for child in root.children if child.name.endswith("_WEB_LOD1"))
        scale, rotation = poses[asset_id]
        keyframe_cycle(
            lod1,
            peak_scale=scale,
            peak_rotation=rotation,
            action_name=f"SIGNATURE_{str(asset_id).upper()}_BALANCED_7S",
        )


def render_only_from_master() -> None:
    """Refresh the nine 4K acceptance frames without rebuilding every mesh."""
    if not BLEND_PATH.exists():
        raise FileNotFoundError(f"Blender master does not exist: {BLEND_PATH}")
    bpy.ops.wm.open_mainfile(filepath=str(BLEND_PATH))
    scene = bpy.context.scene
    star_root = bpy.data.objects["ReactorSun_ROOT"]
    planet_roots = {meta["id"]: bpy.data.objects[f"Planet_{meta['id']}_ROOT"] for meta in PLANETS}
    asset_roots = [star_root] + [planet_roots[meta["id"]] for meta in PLANETS]
    camera = bpy.data.objects["OrbitRenderCamera"]
    render_acceptance_frames(scene, camera, asset_roots, star_root, planet_roots)

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["star"]["hero"] = render_descriptor(RENDERS / "star-hero.png")
    for planet in manifest["planets"]:
        planet["hero"] = render_descriptor(RENDERS / f"{planet['id']}-hero.png")
    manifest["renders"]["systemOverview"] = render_descriptor(RENDERS / "system-overview.png")
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("RENDER_ONLY_COMPLETE=9")


def main() -> None:
    if os.environ.get("ORBIT_RENDER_ONLY") == "1":
        render_only_from_master()
        return
    random.seed(950)
    OUT.mkdir(parents=True, exist_ok=True)
    MODELS.mkdir(parents=True, exist_ok=True)
    RENDERS.mkdir(parents=True, exist_ok=True)
    scene = reset_scene()
    mats = create_materials()
    system_root = add_empty("OrbitSystem_ROOT", display="SPHERE", size=8.0)
    system_root["project"] = "PROJECT ORBIT"
    system_root["brand"] = "e Gain Technologies Ltd."
    system_root["systemChoreographyOwner"] = "Three.js / GSAP"
    system_root["planetCount"] = 7

    star_root = build_reactor_star(system_root, mats)
    builders = {
        "transform": build_transform,
        "build": build_build,
        "experience": build_experience,
        "test": build_test,
        "deploy": build_deploy,
        "protect": build_protect,
        "operate": build_operate,
    }
    planet_roots = {meta["id"]: builders[meta["id"]](meta, system_root, mats) for meta in PLANETS}
    build_system_infrastructure(system_root, mats)
    camera = create_camera_and_lights(scene, mats)
    create_hero_backdrop(mats)
    asset_roots = [star_root] + [planet_roots[meta["id"]] for meta in PLANETS]
    attach_balanced_actions(asset_roots)
    create_authored_flythrough(scene, star_root, planet_roots)

    scene_stats()
    # ORBIT_SKIP_RENDERS is a developer smoke-test switch; the default/full
    # pipeline always creates the nine acceptance frames.
    skip_renders = os.environ.get("ORBIT_SKIP_RENDERS") == "1"
    if not skip_renders:
        render_acceptance_frames(scene, camera, asset_roots, star_root, planet_roots)
    configure_visibility(asset_roots, asset_roots, 0)
    scene.frame_set(1)
    # Preserve the 60-second review camera in the .blend master.  GLB exports
    # below return to the 7-second signature-action frame range.
    scene.frame_end = 1440
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)
    scene.frame_end = ACTION_END

    star_paths = export_asset_pair("star", star_root)
    planet_paths = {meta["id"]: export_asset_pair(meta["id"], planet_roots[meta["id"]]) for meta in PLANETS}
    system_ultra = MODELS / "orbit-system-ultra.glb"
    system_balanced = MODELS / "orbit-system-balanced.glb"
    export_selected(system_ultra, system_selection(system_root, asset_roots, 0))
    export_selected(system_balanced, system_selection(system_root, asset_roots, 1))
    manifest = None
    required_renders = [RENDERS / "star-hero.png", RENDERS / "system-overview.png"] + [
        RENDERS / f"{meta['id']}-hero.png" for meta in PLANETS
    ]
    if not skip_renders or all(path.exists() for path in required_renders):
        manifest = build_manifest((system_ultra, system_balanced), star_paths, planet_paths)

    print(f"BLEND={BLEND_PATH}")
    print(f"MANIFEST={MANIFEST_PATH}")
    print(f"SYSTEM_ULTRA_BYTES={system_ultra.stat().st_size}")
    print(f"SYSTEM_BALANCED_BYTES={system_balanced.stat().st_size}")
    print(f"RENDER_COUNT={1 + len(asset_roots)}")
    print(f"MANIFEST_PLANETS={len(manifest['planets']) if manifest else 'SKIPPED'}")


if __name__ == "__main__":
    main()
