import { createCommonjsModule } from '../_virtual/_commonjsHelpers.js';
import Matter_1 from '../core/Matter.js';
import Axes_1 from '../geometry/Axes.js';
import Bodies_1 from '../factory/Bodies.js';
import Body_1 from '../body/Body.js';
import Bounds_1 from '../geometry/Bounds.js';
import Common_1 from '../core/Common.js';
import Composite_1 from '../body/Composite.js';
import Composites_1 from '../factory/Composites.js';
import Constraint_1 from '../constraint/Constraint.js';
import Contact_1 from '../collision/Contact.js';
import Detector_1 from '../collision/Detector.js';
import Engine_1 from '../core/Engine.js';
import Events_1 from '../core/Events.js';
import Grid_1 from '../collision/Grid.js';
import Mouse_1 from '../core/Mouse.js';
import MouseConstraint_1 from '../constraint/MouseConstraint.js';
import Pair_1 from '../collision/Pair.js';
import Pairs_1 from '../collision/Pairs.js';
import Plugin_1 from '../core/Plugin.js';
import Query_1 from '../collision/Query.js';
import Render_1 from '../render/Render.js';
import Resolver_1 from '../collision/Resolver.js';
import Runner_1 from '../core/Runner.js';
import SAT_1 from '../collision/SAT.js';
import Sleeping_1 from '../core/Sleeping.js';
import Svg_1 from '../geometry/Svg.js';
import Vector_1 from '../geometry/Vector.js';
import Vertices_1 from '../geometry/Vertices.js';
import World_1 from '../body/World.js';

var main = createCommonjsModule(function (module) {
var Matter = module.exports = Matter_1;

Matter.Axes = Axes_1;
Matter.Bodies = Bodies_1;
Matter.Body = Body_1;
Matter.Bounds = Bounds_1;
Matter.Common = Common_1;
Matter.Composite = Composite_1;
Matter.Composites = Composites_1;
Matter.Constraint = Constraint_1;
Matter.Contact = Contact_1;
Matter.Detector = Detector_1;
Matter.Engine = Engine_1;
Matter.Events = Events_1;
Matter.Grid = Grid_1;
Matter.Mouse = Mouse_1;
Matter.MouseConstraint = MouseConstraint_1;
Matter.Pair = Pair_1;
Matter.Pairs = Pairs_1;
Matter.Plugin = Plugin_1;
Matter.Query = Query_1;
Matter.Render = Render_1;
Matter.Resolver = Resolver_1;
Matter.Runner = Runner_1;
Matter.SAT = SAT_1;
Matter.Sleeping = Sleeping_1;
Matter.Svg = Svg_1;
Matter.Vector = Vector_1;
Matter.Vertices = Vertices_1;
Matter.World = World_1;

// temporary back compatibility
Matter.Engine.run = Matter.Runner.run;
Matter.Common.deprecated(Matter.Engine, 'run', 'Engine.run ➤ use Matter.Runner.run(engine) instead');
});

export default main;
