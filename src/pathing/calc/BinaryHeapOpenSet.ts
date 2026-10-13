import type { PathNode } from "./PathNode";

const INITIAL_CAPACITY = 1024;

export class BinaryHeapOpenSet {
    private array: (PathNode | null)[];
    private keys: Float64Array;
    private size_ = 0;

    constructor(size = INITIAL_CAPACITY) {
        this.array = new Array(size).fill(null);
        this.keys = new Float64Array(size);
    }

    size(): number {
        return this.size_;
    }

    insert(value: PathNode): void {
        if (this.size_ >= this.array.length - 1) {
            const newLen = this.array.length << 1;
            this.array.length = newLen;
            const k = new Float64Array(newLen);
            k.set(this.keys);
            this.keys = k;
        }
        this.size_++;
        this.siftUp(this.size_, value, value.combinedCost);
    }

    update(val: PathNode): void {
        this.siftUp(val.heapPosition, val, val.combinedCost);
    }

    private siftUp(index: number, val: PathNode, cost: number): void {
        const array = this.array;
        const keys = this.keys;
        let parentInd = index >>> 1;
        while (index > 1 && keys[parentInd] > cost) {
            const parentNode = array[parentInd]!;
            array[index] = parentNode;
            keys[index] = keys[parentInd];
            parentNode.heapPosition = index;
            index = parentInd;
            parentInd = index >>> 1;
        }
        array[index] = val;
        keys[index] = cost;
        val.heapPosition = index;
    }

    isEmpty(): boolean {
        return this.size_ === 0;
    }

    removeLowest(): PathNode {
        if (this.size_ === 0) {
            throw new Error("Cannot remove from empty heap");
        }
        const array = this.array;
        const keys = this.keys;
        const result = array[1]!;
        result.heapPosition = -1;
        const val = array[this.size_]!;
        const cost = keys[this.size_];
        array[this.size_] = null;
        this.size_--;
        const size = this.size_;
        if (size === 0) {
            return result;
        }
        let index = 1;
        let child = 2;
        while (child <= size) {
            let childCost = keys[child];
            if (child < size && keys[child + 1] < childCost) {
                child++;
                childCost = keys[child];
            }
            if (cost <= childCost) {
                break;
            }
            const childNode = array[child]!;
            array[index] = childNode;
            keys[index] = childCost;
            childNode.heapPosition = index;
            index = child;
            child = index << 1;
        }
        array[index] = val;
        keys[index] = cost;
        val.heapPosition = index;
        return result;
    }
}
