/* Blockcraft renderer: shaders, matrix math and a small raw-WebGL renderer for chunk
   meshes (opaque + blended water), a sky gradient and the block outline. Loaded after
   blockcraft-world.js and before blockcraft.js. -> window.MacBlockcraftGL */
(function () {
  'use strict';

  const CHUNK_SIZE = window.MacBlockcraftWorld.SIZE.chunk;
  const FOG_RANGE = [26, 62];
  const FLOATS_PER_VERTEX = 6;
  const VERTEX_STRIDE = FLOATS_PER_VERTEX * 4;

  // ---- Shaders ----------------------------------------------------------------------

  const CHUNK_VS = `attribute vec3 aPos; attribute vec2 aUV; attribute float aLight;
uniform mat4 uProj; uniform mat4 uView;
varying vec2 vUV; varying float vLight; varying float vDist;
void main() { vec4 p = uView * vec4(aPos, 1.0); vDist = length(p.xyz); vUV = aUV; vLight = aLight; gl_Position = uProj * p; }`;
  const CHUNK_FS = `precision mediump float;
uniform sampler2D uTex; uniform vec3 uFog; uniform vec2 uFogRange; uniform float uSun; uniform float uWater;
varying vec2 vUV; varying float vLight; varying float vDist;
void main() {
  vec4 c = texture2D(uTex, vUV);
  if (uWater < 0.5) { if (c.a < 0.5) discard; c.a = 1.0; }
  float f = smoothstep(uFogRange.x, uFogRange.y, vDist);
  gl_FragColor = vec4(mix(c.rgb * vLight * uSun, uFog, f), mix(c.a, 1.0, f));
}`;
  const SKY_VS = `attribute vec2 aPos; varying float vY;
void main() { vY = aPos.y; gl_Position = vec4(aPos, 0.9999, 1.0); }`;
  const SKY_FS = `precision mediump float;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform float uPitch; uniform float uTanHalf; varying float vY;
void main() {
  float e = uPitch + atan(vY * uTanHalf);
  vec3 c = e < 0.0 ? uHorizon * (1.0 + e * 0.5) : mix(uHorizon, uZenith, smoothstep(0.0, 1.0, e * 1.3));
  gl_FragColor = vec4(c, 1.0);
}`;
  const LINE_VS = `attribute vec3 aPos; uniform mat4 uProj; uniform mat4 uView; uniform vec3 uOffset;
void main() { gl_Position = uProj * uView * vec4(aPos + uOffset, 1.0); }`;
  const LINE_FS = `precision mediump float; uniform vec4 uColor; void main() { gl_FragColor = uColor; }`;

  // ---- Math -------------------------------------------------------------------------

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  // Rx(-pitch) · Ry(-yaw) · T(-eye), column-major.
  function viewMatrix(eye, yaw, pitch) {
    const ca = Math.cos(-pitch);
    const sa = Math.sin(-pitch);
    const cb = Math.cos(-yaw);
    const sb = Math.sin(-yaw);
    const r0 = [cb, 0, sb];
    const r1 = [sa * sb, ca, -sa * cb];
    const r2 = [-ca * sb, sa, ca * cb];
    const dot = (r) => r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2];
    return new Float32Array([r0[0], r1[0], r2[0], 0, r0[1], r1[1], r2[1], 0, r0[2], r1[2], r2[2], 0, -dot(r0), -dot(r1), -dot(r2), 1]);
  }

  const lookDir = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

  // ---- WebGL renderer ---------------------------------------------------------------

  function compile(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    return shader;
  }

  function makeProgram(gl, vs, fs, attribs) {
    const prog = gl.createProgram();
    const shaders = [compile(gl, gl.VERTEX_SHADER, vs), compile(gl, gl.FRAGMENT_SHADER, fs)];
    shaders.forEach((s) => gl.attachShader(prog, s));
    attribs.forEach((name, i) => gl.bindAttribLocation(prog, i, name));
    gl.linkProgram(prog);
    shaders.forEach((s) => gl.deleteShader(s));
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(prog, i).name;
      u[name] = gl.getUniformLocation(prog, name);
    }
    return { prog, u };
  }

  function staticBuffer(gl, data) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  }

  function atlasTexture(gl, atlas) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlas.size, atlas.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // The 12 edges of a unit cube, pushed out a hair so the outline never z-fights.
  function outlineVerts() {
    const lo = -0.002;
    const hi = 1.002;
    const c = (i) => [i & 1 ? hi : lo, i & 2 ? hi : lo, i & 4 ? hi : lo];
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    return new Float32Array(edges.flatMap(([a, b]) => [...c(a), ...c(b)]));
  }

  function createRenderer(gl, atlas) {
    const progs = {
      chunk: makeProgram(gl, CHUNK_VS, CHUNK_FS, ['aPos', 'aUV', 'aLight']),
      sky: makeProgram(gl, SKY_VS, SKY_FS, ['aPos']),
      line: makeProgram(gl, LINE_VS, LINE_FS, ['aPos']),
    };
    const texture = atlasTexture(gl, atlas);
    const skyBuf = staticBuffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3]));
    const lineBuf = staticBuffer(gl, outlineVerts());
    const chunks = new Map();
    // Falling blocks: a small mesh rewritten every frame while anything is in the air.
    const bodies = { opaque: { buf: gl.createBuffer(), count: 0 } };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    function setChunk(cx, cz, mesh) {
      const key = `${cx},${cz}`;
      const entry = chunks.get(key) || { cx, cz, opaque: { buf: gl.createBuffer(), count: 0 }, water: { buf: gl.createBuffer(), count: 0 } };
      ['opaque', 'water'].forEach((layer) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, entry[layer].buf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh[layer], gl.STATIC_DRAW);
        entry[layer] = { ...entry[layer], count: mesh[layer].length / FLOATS_PER_VERTEX };
      });
      chunks.set(key, entry);
    }

    function setBodies(mesh) {
      if (!mesh.length && !bodies.opaque.count) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, bodies.opaque.buf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW);
      bodies.opaque = { ...bodies.opaque, count: mesh.length / FLOATS_PER_VERTEX };
    }

    function useAttribs(count) {
      [0, 1, 2].forEach((i) => (i < count ? gl.enableVertexAttribArray(i) : gl.disableVertexAttribArray(i)));
    }

    function drawSky(f) {
      const { prog, u } = progs.sky;
      gl.useProgram(prog);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      useAttribs(1);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(u.uZenith, f.sky.zenith);
      gl.uniform3fv(u.uHorizon, f.sky.horizon);
      gl.uniform1f(u.uPitch, f.pitch);
      gl.uniform1f(u.uTanHalf, f.tanHalf);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    }

    function chunkOrder(f, layer) {
      const list = [...chunks.values()].filter((c) => c[layer].count > 0);
      if (layer === 'opaque') return bodies.opaque.count ? [...list, bodies] : list;
      const dist = (c) => Math.hypot((c.cx + 0.5) * CHUNK_SIZE - f.eye[0], (c.cz + 0.5) * CHUNK_SIZE - f.eye[2]);
      return list.sort((a, b) => dist(b) - dist(a)); // far to near for blending
    }

    function drawLayer(f, layer) {
      const { prog, u } = progs.chunk;
      const water = layer === 'water';
      gl.useProgram(prog);
      useAttribs(3);
      gl.uniformMatrix4fv(u.uProj, false, f.proj);
      gl.uniformMatrix4fv(u.uView, false, f.view);
      gl.uniform3fv(u.uFog, f.sky.horizon);
      gl.uniform2fv(u.uFogRange, FOG_RANGE);
      gl.uniform1f(u.uSun, f.sky.sun);
      gl.uniform1f(u.uWater, water ? 1 : 0);
      gl.uniform1i(u.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (water) gl.disable(gl.CULL_FACE);
      else gl.enable(gl.CULL_FACE);
      gl.depthMask(!water);
      if (water) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      chunkOrder(f, layer).forEach((c) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, c[layer].buf);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE, 0);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_STRIDE, 12);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, VERTEX_STRIDE, 20);
        gl.drawArrays(gl.TRIANGLES, 0, c[layer].count);
      });
      gl.depthMask(true);
    }

    function drawOutline(f) {
      if (!f.target) return;
      const { prog, u } = progs.line;
      gl.useProgram(prog);
      useAttribs(1);
      gl.enable(gl.BLEND);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(u.uProj, false, f.proj);
      gl.uniformMatrix4fv(u.uView, false, f.view);
      gl.uniform3f(u.uOffset, f.target.x, f.target.y, f.target.z);
      gl.uniform4fv(u.uColor, f.sky.line);
      gl.drawArrays(gl.LINES, 0, 24);
      gl.disable(gl.BLEND);
    }

    function draw(f) {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawSky(f);
      drawLayer(f, 'opaque');
      drawLayer(f, 'water');
      drawOutline(f);
    }

    function dispose() {
      chunks.forEach((c) => [c.opaque.buf, c.water.buf].forEach((b) => gl.deleteBuffer(b)));
      chunks.clear();
      [skyBuf, lineBuf, bodies.opaque.buf].forEach((b) => gl.deleteBuffer(b));
      gl.deleteTexture(texture);
      Object.values(progs).forEach((p) => gl.deleteProgram(p.prog));
    }

    return { setChunk, setBodies, draw, dispose };
  }

  window.MacBlockcraftGL = Object.freeze({ perspective, viewMatrix, lookDir, createRenderer });
})();
