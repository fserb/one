/*
Rope

- world progression
- water
- shot UI
*/

import * as one from "./one/one.js";
import {C, act, ease, mouse, vec, camera} from "./one/one.js";

import pl from "./one/lib/planck.js";

one.description("rope", `
stay alive
`);

const L = {
  bg: "#111",
  fg: C[19],
  water: C[9],
  rope: C[20],
  dark: C[19],
  eye: C[1],
  iris: C[4],
  alien: C[7],
  body: C[5],
  grass: C[25],
};

one.options({
  bgColor: "#000", // L.bg
  fgColor: L.fg,
});

let ropes;
let PLAYER, world;
let shot = null;

const FREE = {group: -1, mask: 0, category: 0};

function init() {
  ropes = [];
  world = pl.World({});
  world.setGravity({x: 0, y: 9.8});

  createPlayer();
  addRope(-0.5, -4.5, 5);
  addRope(-3, -6.5, 5);
  addRope(3, -6.5, 5);

  world.on('post-solve', postSolve);
  world.on('pre-solve', preSolve);

  one.camera.reset();
  one.camera.z = 10.24;
  one.camera.set(one.camera.lookAt(0, 0));
}

function createPlayer() {
  PLAYER = {
    arms: [
      {hold: null, hand: null, joint: null, holder: null, holderTime: 0},
      {hold: null, hand: null, joint: null, holder: null, holderTime: 0},
    ],
    head: null,
    body: [],
    eye: {x: 0, y: 0},
    pupil: 0,
    blink: 0, blinking: 1, looking: 2, breath: 0,
  }

  PLAYER.head = world.createDynamicBody({
    // linearDamping: 0,
  });
  const density = 1 / 10;
  // @ts-ignore
  PLAYER.head.createFixture(pl.Circle(pl.Vec2(0, 0), 0.6),
    {density: density,
      filterGroupIndex: -1, filterCategoryBits: 0 });
  // @ts-ignore
  PLAYER.head.setPosition({x: 0, y: 0});

  let last = PLAYER.head;
  for (let i = 0; i < 2; ++i) {
    const o = world.createDynamicBody({
      gravityScale: 1,
    });
    o.radius = 0.4 - i * 0.2;
    o.createFixture(pl.Circle(pl.Vec2(0, 0), o.radius),
    {density: density, isSensor: true,
     filterGroupIndex: -1, filterCategoryBits: 0});
    o.setPosition({x: 0, y: 1 * i});

    world.createJoint(pl.RopeJoint({
      maxLength: 1.0 - i * 0.4,
      localAnchorA: pl.Vec2(0, 0), localAnchorB: pl.Vec2(0, 0),
    }, last, o));
    last = o;
    PLAYER.body.push(o);
  }

  let first = true;
  for (const a of PLAYER.arms) {
    a.hand = world.createDynamicBody({
      userData: "hand", bullet: true, linearDamping: 0.1});
    a.hand.createFixture(pl.Circle(pl.Vec2(0, 0), 0.5),
      {isSensor: true});
    a.hand.createFixture(pl.Circle(pl.Vec2(0, 0), 0.1),
      {density: 0, filterGroupIndex: 3});
    a.hand.createFixture(pl.Circle(pl.Vec2(0, 0), 0.3),
      {density: 1,
        filterCategoryBits: 4, filterMaskBits: 4 });
    a.joint = world.createDynamicBody({
      // linearDamping: 0,
    });
    a.joint.createFixture(pl.Circle(pl.Vec2(0, 0), 0.1),
      {density: 0.1,});
    a.hand.setStatic();

    if (first) {
      first = false;
      a.hand.setPosition({x:-1.5, y:-1});
      a.joint.setPosition({x:-1, y:-0.5});
    } else {
      a.hand.setPosition({x:1.5, y:-1});
      a.joint.setPosition({x:1, y:-0.5});
    }

    world.createJoint(pl.RopeJoint({
      maxLength: 0.9, localAnchorA: pl.Vec2(0, 0), localAnchorB: pl.Vec2(0, 0),
    }, a.hand, a.joint));

    world.createJoint(pl.RopeJoint({
      maxLength: 0.9, localAnchorA: pl.Vec2(0, 0), localAnchorB: pl.Vec2(0, 0),
    }, a.joint, PLAYER.head));

    world.createJoint(pl.DistanceJoint({
      length: 0.85, localAnchorA: pl.Vec2(0, 0), localAnchorB: pl.Vec2(0, 0),
      collideConnected: false, frequencyHz: 10, dampingRatio: 0.5,
    }, a.hand, a.joint));

    world.createJoint(pl.DistanceJoint({
      length: 0.85, localAnchorA: pl.Vec2(0, 0), localAnchorB: pl.Vec2(0, 0),
      collideConnected: false, frequencyHz: 10, dampingRatio: 0.5,
    }, a.joint, PLAYER.head));
  }
}

function addRope(x, y, length) {
  const parts =  Math.round(length);
  const size = length / parts;

  const obj = [];

  const h = world.createBody();
  h.setPosition({x, y});
  obj.push(h);

  const dir = Math.sign(Math.random()) * 0.25;
  for (let i = 0; i < parts; ++i) {
    const p = world.createDynamicBody({
      userData: "rope",
      linearDamping: 0.25,
    });
    p.parent = obj;
    p.createFixture(pl.Box(0.025, size / 2, {x: 0, y: -size / 2}), {
      density: 9.5 - i * 0.2,
      filterGroupIndex: -3,
      filterCategoryBits: 4,
      filterMaskBits: 4,
    });
    p.setPosition({x: x + dir * i, y: y + size / 2 + (size * 1.2) * i});
    // p.setStatic();
    obj.push(p);
  }

  for (let i = 0; i < obj.length - 1; ++i) {
    world.createJoint(pl.RopeJoint({
      maxLength: 0.1,
      collideConnected: false,
      localAnchorA: pl.Vec2(0, 0),
      localAnchorB: pl.Vec2(0, -size),
    }, obj[i], obj[i + 1]));
    world.createJoint(pl.DistanceJoint({
      length: 0.1,
      frequencyHz: 10, dampingRatio: size / 2,
      collideConnected: false,
      localAnchorA: pl.Vec2(0, 0),
      localAnchorB: pl.Vec2(0, -size),
    }, obj[i], obj[i + 1]));
  }

  ropes.push(obj);
}

const UPDATE = [];

function preSolve(contact) {
  const bodyA = contact.getFixtureA().getBody();
  const bodyB = contact.getFixtureB().getBody();

  let hand = bodyA.getUserData() == "hand" ? bodyA :
    bodyB.getUserData() == "hand" ? bodyB : null;
  let rope = bodyA.getUserData() == "rope" ? bodyA :
    bodyB.getUserData() == "rope" ? bodyB : null;

  if (hand == null || rope == null) return;
  const arm = PLAYER.arms[0].hand === hand ? PLAYER.arms[0] : PLAYER.arms[1];
  const now = performance.now();
  if (arm.holder != rope.parent) return;
  if (arm.holderTime == -1) return;
  if (arm.holderTime < now) return;
  contact.setEnabled(false);
}

function postSolve(contact) {
  const bodyA = contact.getFixtureA().getBody();
  const bodyB = contact.getFixtureB().getBody();

  let hand = bodyA.getUserData() == "hand" ? bodyA :
    bodyB.getUserData() == "hand" ? bodyB : null;
  let rope = bodyA.getUserData() == "rope" ? bodyA :
    bodyB.getUserData() == "rope" ? bodyB : null;

  if (hand == null || rope == null) return;
  const arm = PLAYER.arms[0].hand === hand ? PLAYER.arms[0] : PLAYER.arms[1];
  const now = performance.now();
  if (arm.holder == rope.parent &&
    (arm.holderTime == -1 || arm.holderTime > now)) return;
  const wm = contact.getWorldManifold();
  const p = wm.points[0];

  UPDATE.push(() => {
    arm.hold = pl.DistanceJoint({
      length: 0, collideConnected: false,
    }, hand, rope, hand.getPosition(), p);
    world.createJoint(arm.hold);
  });
  arm.holder = rope.parent;
  arm.holderTime = -1;
}

function updatePlayer(tick) {
  PLAYER.breath = Math.sin(tick * 2 * Math.PI / 500);
  PLAYER.pupil = Math.cos(333 + tick * 2 * Math.PI / 1713);
  PLAYER.blinking -= 1/60;
  if (PLAYER.blinking <= 0 && PLAYER.blink == 0) {
    act(PLAYER).attr("blink", 1.0, 0.15, ease.quadIn).then()
      .attr("blink", 0.0, 0.15, ease.quadIn);
    PLAYER.blinking = 2 + 8 * Math.random();
  }
  PLAYER.looking -= 1/60;
  if (PLAYER.looking <= 0) {
    PLAYER.looking = 2 + 10 * Math.random();
    const t = {x : -1 + 2 * Math.random(), y: -1 + 2 * Math.random()};
    act(PLAYER.eye).stop()
      .attr("x", t.x, 0.5 + 0.3 * Math.random(), ease.quadIn)
      .attr("y", t.y, 0.5 + 0.3 * Math.random(), ease.quadIn);
  }

  if (mouse.click) {
    const p = one.camera.map(mouse);
    const aabb = pl.AABB({x: p.x - 0.001, y: p.y - 0.001},
      {x: p.x + 0.001, y: p.y + 0.001});

    world.queryAABB(aabb, (x) => {
      if (x.getBody().getUserData() != "hand") return;

      shot = {
        hand: x.getBody(),
        target: {x: mouse.x, y: mouse.y },
      };
      return false;
    });
  }
}

let x = 0;
function updateCamera() {
  const p = PLAYER.head.getPosition();
  const target = one.camera.lookAt(p.x, p.y);

  // const d = vec.sub(PLAYER.arms[0].hand.getPosition(), PLAYER.arms[1].hand.getPosition());
  const d = vec.sub(target, one.camera);
  let ang = Math.TAU * -d.x / 30;
  if (Math.abs(ang) < Math.TAU / 30) ang = 0;
  target.angle = ang;

  if (x++ % 100 == 0) console.log(target.x, target.angle);
  one.camera.approach(target, {x: 0.02, y: 0.005, angle: 0.04});
}

function update(tick) {
  world.step(1/60);
  for (const w of UPDATE) w();
  UPDATE.length = 0;

  updatePlayer(tick);
  updateCamera();

  if (!shot) return;

  if (mouse.press) {
    shot.target = one.camera.map(mouse);
  } else if (mouse.release) {
    const p = shot.hand.getPosition();
    const d = vec.mul(vec.sub(p, shot.target), 100);
    console.log(vec.len(d));

    const arm = PLAYER.arms[0].hand === shot.hand ? PLAYER.arms[0] : PLAYER.arms[1];

    if (arm.hold) {
      world.destroyJoint(arm.hold);
      arm.holderTime = performance.now() + 300;
      arm.hold = null;
    }


    shot.hand.setDynamic();
    shot.hand.applyForceToCenter(d);
    shot = null;
  }
}

function render(ctx) {
  ctx.fillStyle = L.fg;
  ctx.fillRect(0,0,1024,1024);

  one.camera.transform(ctx);
  ctx.fillStyle = L.bg;
  const B = 0.5;
  ctx.fillRect(B + one.camera.cx - 5.12, B + one.camera.cy - 5.12, 10.24 - 2 * B, 10.24 - 2 * B);
  ctx.beginPath();
  ctx.rect(B + one.camera.cx - 5.12, B + one.camera.cy - 5.12, 10.24 - 2 * B, 10.24 - 2 * B);
  ctx.clip();

  for (const r of ropes) {
    renderRope(ctx, r);
  }
  renderPlayer(ctx);

  if (shot) {
    ctx.strokeStyle = C[17];
    const p = shot.hand.getPosition();
    const d = vec.len(vec.sub(shot.target, p));
    ctx.lineWidth = d / 10;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(shot.target.x, shot.target.y);
    ctx.stroke();
  }

  // renderDebug(ctx);
}

const BIGARM = 0.6;
const SMALLARM = 0.15;
function renderPlayer(ctx) {
  ctx.fillStyle = L.alien;
  const h = PLAYER.head.getPosition();
  for (const arm of PLAYER.arms) {
    const p = arm.hand.getPosition();
    ctx.strokeStyle = L.body;
    ctx.fillStyle = L.body;
    const j = arm.joint.getPosition();
    const n = vec.normalize(vec.perp(vec.sub(h, p)));

    ctx.beginPath();
    ctx.moveTo(p.x + n.x * SMALLARM, p.y + n.y * SMALLARM);
    ctx.quadraticCurveTo(j.x, j.y, h.x + n.x * BIGARM, h.y + n.y * BIGARM);
    ctx.lineTo(h.x - n.x * BIGARM, h.y - n.y * BIGARM);
    ctx.quadraticCurveTo(j.x, j.y, p.x - n.x * SMALLARM, p.y - n.y * SMALLARM);
    ctx.fill();
  }

  for (const arm of PLAYER.arms) {
    const p = arm.hand.getPosition();
    ctx.fillStyle = L.alien;
    ctx.fillCircle(p.x, p.y, arm.hold ? 0.22 : 0.3);
  }

  // ctx.fillStyle = L.alien;
  // ctx.fillCircle(h.x, h.y, 0.6);

  ctx.fillStyle = L.body;

  let m = PLAYER.body[0].getPosition().clone();
  let om = m;
  const b = PLAYER.body[1];
  const p = b.getPosition().clone();
  // p.x += 0.1;
  // p.y -= 0.7;
  const bp = vec.mul(vec.add(h, p), 0.5);
  const rm = vec.clamp(vec.sub(m, bp), 0, 0.3);
  m = vec.add(bp, rm);

  const nm = vec.normalize(vec.perp(vec.sub(h, m)));
  const v = vec.sub(m, p);
  const vn = vec.normalize(v);
  const n = vec.normalize(vec.perp(v));
  let j1 = vec.add(m, vec.mul(n, 0.3));
  let j2 = vec.add(m, vec.mul(n, -0.3));

  ctx.beginPath();
  ctx.moveTo(p.x - n.x * b.radius, p.y - n.y * b.radius);
  ctx.quadraticCurveTo(j2.x, j2.y, h.x - nm.x * 0.6, h.y - nm.y * 0.6);
  ctx.lineTo(h.x + nm.x * 0.6, h.y + nm.y * 0.6);
  ctx.quadraticCurveTo(j1.x, j1.y, p.x + n.x * b.radius, p.y + n.y * b.radius);
  ctx.arcTo(
    p.x - vn.x * b.radius * 5, p.y - vn.y * b.radius * 5,
    p.x - n.x * b.radius, p.y - n.y * b.radius, b.radius);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.translate(h.x, h.y);
  const scale = 0.45 / 38;
  ctx.scale(scale, scale);
  const ER = 16;
  ctx.fillStyle = L.body;
  ctx.fillCircle(0, 0, 51);
  ctx.fillStyle = L.eye;
  ctx.fillCircle(0, 0, 38);
  ctx.fillStyle = L.iris;
  const rb = 20.5 - 1 * PLAYER.pupil;
  const rx = rb - 5 * vec.len(PLAYER.eye);
  const ry = rb;
  const ang = vec.angle(PLAYER.eye);
  ctx.beginPath();
  ctx.ellipse(PLAYER.eye.x * ER, PLAYER.eye.y * ER, rx, ry, ang, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = L.eye;
  const f = Math.sin((vec.len(PLAYER.eye) / Math.SQRT2) * Math.PI / 2) ** 2;
  const ff = 4 + 2 * f;
  const d = (rb / 4) + (rb / 10) * f;
  ctx.beginPath();
  ctx.ellipse(PLAYER.eye.x * ER - d, PLAYER.eye.y * ER - d, rx / ff, ry / ff, ang, 0, 2 * Math.PI);
  ctx.fill();
  if (PLAYER.blink > 0) {
    ctx.fillStyle = L.body;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 39, Math.PI, 2 * Math.PI);
    if (PLAYER.blink < 0.5) {
      ctx.ellipse(0, 0, 39, Math.lerp(39, 0, PLAYER.blink * 2), 0, 0, Math.PI, true);
    } else {
      ctx.ellipse(0, 0, 39, Math.lerp(0, 39, (PLAYER.blink - 0.5) * 2), 0, 0, Math.PI);
    }
    ctx.fill();
  }
  ctx.restore();
}

function renderRope(ctx, r) {
  let prev = r[0].getPosition();


  ctx.fillStyle = L.dark;
  ctx.fillCircle(prev.x, prev.y, 0.2);

  ctx.strokeStyle = L.rope;
  ctx.lineWidth = 0.1;
  ctx.beginPath();

  for (const p of r) {
    const x = p.getWorldCenter();
    // ctx.lineTo(x.x, x.y);
    ctx.quadraticCurveTo(prev.x, prev.y ,x.x, x.y);
    prev = p.getPosition();
  }

  ctx.lineTo(prev.x, prev.y);
  ctx.stroke();
  prev = r[0].getPosition();
  ctx.fillStyle = L.dark;
  ctx.fillCircle(prev.x, prev.y, 0.2);
}

function renderDebug(ctx) {
  ctx.strokeStyle = "white";
  ctx.lineWidth = 0.005;
  for (let body = world.getBodyList(); body; body = body.getNext()) {
    const pos = body.getPosition();
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(body.getAngle());
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      const shape = fixture.m_shape;

      if (shape.m_type == "circle") {
        ctx.strokeCircle(shape.m_p.x, shape.m_p.y, shape.m_radius);
        continue;
      }
      if (shape.m_type == "polygon") {
        ctx.beginPath();
        for (const v of shape.m_vertices) {
          ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // console.log(shape.m_type);
    }
    ctx.restore();
  }
}


export default one.game(init, update, render);
