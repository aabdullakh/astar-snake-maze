/* heap.js
 * A binary min-heap used as A*'s "open list".
 * Each item looks like { i: cellIndex, f: number, g: number }.
 * pop() always returns the item with the lowest f.
 */
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  // Lowest f first. On a tie, prefer the larger g (a cell further along the route),
  // which usually wastes fewer expansions.
  less(p, q) {
    return p.f < q.f || (p.f === q.f && p.g > q.g);
  }

  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(a[i], a[parent])) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < a.length && this.less(a[l], a[smallest])) smallest = l;
        if (r < a.length && this.less(a[r], a[smallest])) smallest = r;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]];
        i = smallest;
      }
    }
    return top;
  }
}
