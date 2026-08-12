import { Effect, Layer } from "effect"
import { FSUtil } from "../fs-util"
import { AppProcess } from "../process"
import { makeGlobalNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { Repository } from "./schema"
import { Service } from "./service"
import { makeOperations } from "./operations"
import { makeRepositoryOps } from "./ops/repository"
import { makeTreeOps } from "./ops/tree"
import { makeChangeOps } from "./ops/change"
import { makeWorktreeOps } from "./ops/worktree"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const proc = yield* AppProcess.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const locked = <A, E, R>(repository: Repository, effect: Effect.Effect<A, E, R>) =>
      locks.withLock(repository.gitDirectory)(effect)
    const operations = makeOperations(proc)
    const repo = makeRepositoryOps({ fs, proc, operations })
    const tree = makeTreeOps({ fs, proc, operations, locked })
    const change = makeChangeOps({ proc })
    const worktree = makeWorktreeOps({ proc, repo })

    return Service.of({
      repo: { discover: repo.discover, clone: repo.clone, create: repo.create },
      remote: { get: repo.remote },
      history: {
        head: repo.head,
        branch: repo.branch,
        defaultRemoteBranch: repo.remoteHead,
        rootCommits: repo.roots,
      },
      sync: {
        fetchRemotes: repo.fetch,
        fetchBranch: repo.fetchBranch,
        checkoutRemoteBranch: repo.checkout,
        resetHard: repo.reset,
      },
      change: { capture: change.capture, apply: change.apply, discard: change.discard },
      worktree: { create: worktree.create, remove: worktree.remove, list: worktree.list },
      index: { refresh: tree.refresh, ignored: tree.ignored },
      tree: {
        capture: tree.captureTree,
        write: tree.writeTree,
        files: tree.treeFiles,
        diff: tree.treeDiff,
        preview: tree.preview,
        restore: tree.restore,
        checkout: tree.checkoutTree,
      },
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [FSUtil.node, AppProcess.node] })
