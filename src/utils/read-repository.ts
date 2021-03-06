import * as _ from 'lodash';
import type { DocumentReference, DocumentSnapshot, Query, QuerySnapshot } from '@google-cloud/firestore';


export interface ReadRepositoryHandler {
  getAll(...refs: DocumentReference<any>[]): Promise<DocumentSnapshot<any>[]>
  getQuery(query: Query<any>): Promise<QuerySnapshot<any>>
}


/**
 * Utility class for transactions that acts as a caching proxy for read operations.
 */
export class ReadRepository {

  private readonly cache = new Map<string, Promise<DocumentSnapshot<any>>>();

  constructor(
    private readonly delegate: ReadRepository | null, 
    private readonly handler: ReadRepositoryHandler,
  ) { }

  get size(): number {
    return this.cache.size;
  }

  get(ref: DocumentReference): Promise<DocumentSnapshot<any>> {
    const { path } = ref;
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    } else if (this.delegate && this.delegate.cache.has(path)) {
      return this.delegate!.cache.get(path)!;
    } else {
      const p = this.handler.getAll(ref).then(snaps => snaps[0]);
      
      this.cache.set(path, p);
      return p;
    }
  }

  getAll(refs: DocumentReference[]): Promise<DocumentSnapshot<any>[]> {
    // Unique documents that haven't already been fetched
    const toGet = _.uniqBy(refs.filter(({ path }) => !this.cache.has(path)), ({ path }) => path);

    // Defer any that exist in the delegate repository
    const toRead = this.delegate
      ? toGet.filter(({ path }) => !this.delegate!.cache.has(path))
      : toGet;

    // Memoise a promise for each document
    const toReadAsync = toRead.length 
      ? this.handler.getAll(...toGet) 
      : Promise.resolve([]);
    
    toRead.forEach(({ path }, i) => {
      const p = toReadAsync.then(snaps => snaps[i]);
      this.cache.set(path, p);
    });

    // Arrange all the memoised promises as results
    const results = refs.map(({ path }) => {
      return this.cache.get(path) || this.delegate!.cache.get(path)!;
    });
    return Promise.all(results);
  }

  async getQuery(query: Query<any>): Promise<QuerySnapshot<any>> {
    const result = await this.handler.getQuery(query);
    for (const d of result.docs) {
      const { path } = d.ref;
      if (!this.cache.has(path)) {
        this.cache.set(path, Promise.resolve(d));
      }
    }
    return result;
  }
}
