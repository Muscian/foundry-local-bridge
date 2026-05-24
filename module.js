const MODULE_ID = "foundry-local-bridge";
const DEFAULT_WS_URL = "ws://127.0.0.1:3003/ws";
const DEFAULT_RECONNECT_MS = 5000;

let socket = null;
let reconnectTimer = null;
let manualClose = false;

function log(message, ...args) {
  console.log(`Foundry Local Bridge | ${message}`, ...args);
}

function warn(message, ...args) {
  console.warn(`Foundry Local Bridge | ${message}`, ...args);
}

function registerSettings() {
  game.settings.register(MODULE_ID, "wsUrl", {
    name: "Local WebSocket URL",
    hint: "URL of your local automation bridge, for example ws://127.0.0.1:3003/ws.",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_WS_URL,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "enabled", {
    name: "Enable local bridge",
    hint: "Connect this Foundry GM client to your local automation bridge.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });
}

function actorImage(actor) {
  return actor?.img || "icons/svg/mystery-man.svg";
}

function sceneById(sceneId) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas?.scene;
  if (!scene) throw new Error(`Scene not found: ${sceneId || "(active scene)"}`);
  return scene;
}

function tokenById(scene, tokenId) {
  const token = scene.tokens.get(tokenId);
  if (!token) throw new Error(`Token not found: ${tokenId}`);
  return token;
}

function tokenResult(token) {
  const actor = token.actor;
  return {
    id: token.id,
    sceneId: token.parent?.id ?? null,
    name: token.name,
    actorId: token.actorId ?? null,
    x: token.x,
    y: token.y,
    width: token.width,
    height: token.height,
    textureSrc: token.texture?.src ?? null,
    hidden: token.hidden,
    disposition: token.disposition,
    hp: actor?.system?.attributes?.hp
      ? {
          value: actor.system.attributes.hp.value,
          max: actor.system.attributes.hp.max
        }
      : null,
    ac: actor?.system?.attributes?.ac?.value ?? null
  };
}

function sanitizeFilename(filename) {
  const safe = String(filename || "token.png")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "token.png";
}

async function ensureDataDirectory(path) {
  try {
    await FilePicker.createDirectory("data", path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("already exists")) {
      throw error;
    }
  }
}

function dataUrlToFile(dataUrl, filename) {
  const match = String(dataUrl).match(/^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Expected a PNG, WebP, or JPEG data URL");
  }

  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], sanitizeFilename(filename), { type: mimeType });
}

async function uploadTokenImage(params) {
  const savePath = String(params.savePath || `worlds/${game.world.id}/tokens`);
  const filename = sanitizeFilename(params.filename || "token.png");
  const file = dataUrlToFile(params.dataUrl, filename);

  await ensureDataDirectory(savePath);
  const upload = await FilePicker.upload("data", savePath, file, {}, { notify: false });

  return {
    path: upload.path,
    savePath,
    filename,
    type: file.type,
    size: file.size
  };
}

async function setActorPrototypeToken(params) {
  const actor = game.actors.get(params.actorId);
  if (!actor) throw new Error(`Actor not found: ${params.actorId}`);

  const width = Number(params.width ?? actor.prototypeToken?.width ?? 1);
  const height = Number(params.height ?? actor.prototypeToken?.height ?? width);
  const textureSrc = params.textureSrc || actorImage(actor);

  const updateData = {
    "prototypeToken.width": width,
    "prototypeToken.height": height,
    "prototypeToken.texture.src": textureSrc
  };

  if (params.actorLink !== undefined) {
    updateData["prototypeToken.actorLink"] = Boolean(params.actorLink);
  }

  if (params.disposition !== undefined) {
    updateData["prototypeToken.disposition"] = Number(params.disposition);
  }

  if (params.updateActorImg) {
    updateData.img = textureSrc;
  }

  const updated = await actor.update(updateData);

  return {
    id: updated.id,
    name: updated.name,
    img: updated.img,
    prototypeToken: {
      width: updated.prototypeToken.width,
      height: updated.prototypeToken.height,
      textureSrc: updated.prototypeToken.texture.src,
      actorLink: updated.prototypeToken.actorLink,
      disposition: updated.prototypeToken.disposition
    }
  };
}

async function updateTokenFromActor(params) {
  const scene = sceneById(params.sceneId);
  const token = tokenById(scene, params.tokenId);
  const actor = token.actor ?? game.actors.get(token.actorId);
  if (!actor) throw new Error(`Actor not found for token: ${params.tokenId}`);

  const updateData = {
    "texture.src": params.textureSrc || actorImage(actor)
  };

  if (params.width !== undefined) updateData.width = Number(params.width);
  if (params.height !== undefined) updateData.height = Number(params.height);
  if (params.scale !== undefined) {
    updateData["texture.scaleX"] = Number(params.scale);
    updateData["texture.scaleY"] = Number(params.scale);
  }

  const updated = await token.update(updateData);
  return tokenResult(updated);
}

async function createTokenFromActor(params) {
  const scene = sceneById(params.sceneId);
  const actor = game.actors.get(params.actorId);
  if (!actor) throw new Error(`Actor not found: ${params.actorId}`);

  const width = Number(params.width ?? actor.prototypeToken?.width ?? 1);
  const height = Number(params.height ?? actor.prototypeToken?.height ?? width);
  const textureSrc = params.textureSrc || actor.prototypeToken?.texture?.src || actorImage(actor);

  const tokenData = {
    actorId: actor.id,
    name: params.name || actor.name,
    x: Number(params.x ?? 0),
    y: Number(params.y ?? 0),
    width,
    height,
    texture: { src: textureSrc },
    hidden: Boolean(params.hidden ?? false),
    disposition: Number(params.disposition ?? actor.prototypeToken?.disposition ?? -1)
  };

  if (params.elevation !== undefined) tokenData.elevation = Number(params.elevation);
  if (params.rotation !== undefined) tokenData.rotation = Number(params.rotation);

  const [token] = await scene.createEmbeddedDocuments("Token", [tokenData]);
  if (!token) throw new Error("Failed to create token");
  return tokenResult(token);
}

async function handleCommand(command) {
  switch (command.type) {
    case "companion-status":
      return {
        moduleId: MODULE_ID,
        world: game.world.id,
        user: game.user.name,
        isGM: game.user.isGM,
        scene: canvas?.scene
          ? {
              id: canvas.scene.id,
              name: canvas.scene.name
            }
          : null
      };
    case "upload-token-image":
      return await uploadTokenImage(command.params ?? {});
    case "set-actor-prototype-token":
      return await setActorPrototypeToken(command.params ?? {});
    case "update-token-from-actor":
      return await updateTokenFromActor(command.params ?? {});
    case "create-token-from-actor":
      return await createTokenFromActor(command.params ?? {});
    default:
      throw new Error(`Unknown companion command: ${command.type}`);
  }
}

function connect() {
  if (!game.user?.isGM) return;
  if (!game.settings.get(MODULE_ID, "enabled")) return;

  const wsUrl = game.settings.get(MODULE_ID, "wsUrl");
  manualClose = false;
  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    log(`Connected to ${wsUrl}`);
    ui.notifications?.info("Foundry Local Bridge connected");
  });

  socket.addEventListener("message", (event) => {
    void (async () => {
      let command;
      try {
        command = JSON.parse(event.data);
        const data = await handleCommand(command);
        socket.send(JSON.stringify({ id: command.id, success: true, data }));
      } catch (error) {
        socket.send(JSON.stringify({
          id: command?.id ?? "unknown",
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    })();
  });

  socket.addEventListener("close", () => {
    log("Disconnected");
    socket = null;

    if (!manualClose) {
      reconnectTimer = setTimeout(connect, DEFAULT_RECONNECT_MS);
    }
  });

  socket.addEventListener("error", (event) => {
    warn("WebSocket error", event);
  });
}

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  connect();
});

Hooks.once("shutdown", () => {
  manualClose = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (socket) socket.close();
});
