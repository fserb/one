/*
 * pgrid.js - partitions a rectangle into orthogonally-connected regions whose
 * sizes obey a per-size quota. tower's board is one of these: every cell is in
 * exactly one region, and the region sizes are the numbers the puzzle is built
 * out of.
 *
 * solve() is a backtracking search. It always fills from the emptiest cell,
 * which is what keeps a single orphaned square from being left behind: a cell
 * with one free neighbour has to be claimed now or never. growSmartRegion()
 * then grows out of that cell by preferring the candidate with the most
 * neighbours, so a region wraps a pocket rather than snaking past it.
 *
 * A region in one row or one column is rejected. A straight bar reads as a
 * ruler rather than a shape, and the puzzle is read by shape.
 *
 * Sizes are tried in a shuffled order with the under-quota ones first, so two
 * boards off the same constraints do not come out the same.
 */

export class GridFiller {
  constructor(width, height, constraints) {
    this.width = width;
    this.height = height;
    this.constraints = constraints;
    this.grid = Array.from({ length: height }, () => new Array(width).fill(0));
    this.groupId = 1;
    this.groups = new Map();
  }

  isInBounds(x, y, validValue = 0) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height &&
      this.grid[y][x] === validValue;
  }

  getNeighbors(x, y, validValue = 0) {
    return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      .filter(([nx, ny]) => this.isInBounds(nx, ny, validValue));
  }

  forEachCell(callback) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        callback(x, y, this.grid[y][x]);
      }
    }
  }

  // -1 marks the region being grown, so a candidate can tell the cells it has
  // already taken from the cells still free.
  growSmartRegion(startX, startY, targetSize) {
    if (!this.isInBounds(startX, startY)) return null;

    const region = [[startX, startY]];
    this.grid[startY][startX] = -1;

    for (let i = 1; i < targetSize; i++) {
      const candidates = [];

      for (const [x, y] of region) {
        for (const [nx, ny] of this.getNeighbors(x, y)) {
          const emptyNeighbors = this.getNeighbors(nx, ny).length;
          const filledNeighbors = this.getNeighbors(nx, ny, -1).length;
          const neighborCount = emptyNeighbors + filledNeighbors;

          candidates.push({
            x: nx,
            y: ny,
            score: neighborCount + Math.random() * 0.5,
          });
        }
      }

      if (candidates.length === 0) {
        this.setRegion(region, 0);
        return null;
      }

      const chosen = candidates.sort((a, b) =>
        b.score - a.score
      )[Math.floor(Math.random() * Math.min(3, candidates.length))];
      region.push([chosen.x, chosen.y]);
      this.grid[chosen.y][chosen.x] = -1;
    }

    this.setRegion(region, 0);

    if (
      new Set(region.map(([x]) => x)).size === 1 ||
      new Set(region.map(([, y]) => y)).size === 1
    ) {
      return null;
    }

    return region;
  }

  // A list of cells, or the id of every cell already carrying one.
  setRegion(region, value) {
    if (Array.isArray(region)) {
      for (const [x, y] of region) {
        this.grid[y][x] = value;
      }
      return;
    }

    this.forEachCell((x, y, cellValue) => {
      if (cellValue === region) this.grid[y][x] = value;
    });
  }

  findEmptyRegions() {
    const visited = Array.from(
      { length: this.height },
      () => new Array(this.width).fill(false),
    );
    const regions = [];

    this.forEachCell((x, y, value) => {
      if (value !== 0 || visited[y][x]) return;

      const region = [];
      const queue = [[x, y]];
      visited[y][x] = true;

      while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        region.push([cx, cy]);

        for (const [nx, ny] of this.getNeighbors(cx, cy)) {
          if (visited[ny][nx]) continue;
          visited[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }

      regions.push(region);
    });

    return regions;
  }

  getCountForSize(size) {
    return Array.from(this.groups.values()).filter((s) => s === size).length;
  }

  findBestEmptyCell() {
    let bestCell = null;
    let minNeighbors = Infinity;
    this.forEachCell((x, y, value) => {
      if (value !== 0) return;
      const emptyNeighbors = this.getNeighbors(x, y).length;
      if (emptyNeighbors >= minNeighbors) return;
      minNeighbors = emptyNeighbors;
      bestCell = [x, y];
    });
    return bestCell;
  }

  satisfiesMinConstraints() {
    const { minCountPerSize } = this.constraints;
    if (!minCountPerSize) return true;

    return Object.entries(minCountPerSize)
      .every(([size, minCount]) => this.getCountForSize(+size) >= minCount);
  }

  getAvailableSizes() {
    const sizes = [];
    const { minSize, maxSize, maxCountPerSize = {}, minCountPerSize = {} } =
      this.constraints;

    for (let size = minSize; size <= maxSize; size++) {
      const currentCount = this.getCountForSize(size);
      if (currentCount >= (maxCountPerSize[size] ?? Infinity)) continue;

      const minRequired = minCountPerSize[size] ?? 0;
      sizes.push({ size, priority: currentCount < minRequired });
    }

    return sizes
      .sort((a, b) => b.priority - a.priority)
      .map((s) => s.size)
      .sort(() => Math.random() - 0.5);
  }

  solve() {
    const nextEmpty = this.findBestEmptyCell();
    if (!nextEmpty) return this.satisfiesMinConstraints();

    const [x, y] = nextEmpty;

    for (const size of this.getAvailableSizes()) {
      const region = this.growSmartRegion(x, y, size);
      if (!region) continue;

      this.setRegion(region, this.groupId);
      this.groups.set(this.groupId, size);
      this.groupId++;

      if (this.solve()) return true;

      this.groupId--;
      this.setRegion(this.groupId, 0);
      this.groups.delete(this.groupId);
    }

    return false;
  }
}
