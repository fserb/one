import Composite_1 from './Composite.js';
import '../core/Common.js';

/**
* This module has now been replaced by `Matter.Composite`.
*
* All usage should be migrated to the equivalent functions found on `Matter.Composite`.
* For example `World.add(world, body)` now becomes `Composite.add(world, body)`.
*
* The property `world.gravity` has been moved to `engine.gravity`.
*
* For back-compatibility purposes this module will remain as a direct alias to `Matter.Composite` in the short term during migration.
* Eventually this alias module will be marked as deprecated and then later removed in a future release.
*
* @class World
*/

var World = {};

var World_1 = World;




(function() {

    /**
     * See above, aliases for back compatibility only
     */
    World.create = Composite_1.create;
    World.add = Composite_1.add;
    World.remove = Composite_1.remove;
    World.clear = Composite_1.clear;
    World.addComposite = Composite_1.addComposite;
    World.addBody = Composite_1.addBody;
    World.addConstraint = Composite_1.addConstraint;

})();

export default World_1;
