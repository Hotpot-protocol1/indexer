/* eslint-disable @typescript-eslint/no-explicit-any */

import { HashZero } from "@ethersproject/constants";
import { Queue, QueueScheduler, Worker } from "bullmq";
import { randomUUID } from "crypto";

import { idb, pgp } from "@/common/db";
import { logger } from "@/common/logger";
import { redis, redlock } from "@/common/redis";
import { fromBuffer, now, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import { extractAttributionData } from "@/events-sync/utils";

const QUEUE_NAME = "backfill-sales-fill-source";

export const queue = new Queue(QUEUE_NAME, {
  connection: redis.duplicate(),
  defaultJobOptions: {
    attempts: 10,
    removeOnComplete: 10000,
    removeOnFail: 10000,
  },
});
new QueueScheduler(QUEUE_NAME, { connection: redis.duplicate() });

// BACKGROUND WORKER ONLY
if (config.doBackgroundWork) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { timestamp, txHash, logIndex, batchIndex } = job.data;
      const limit = 1000;

      const results = await idb.manyOrNone(
        `
          SELECT
            fill_events_2.tx_hash,
            fill_events_2.log_index,
            fill_events_2.batch_index,
            fill_events_2.timestamp,
            fill_events_2.address,
            fill_events_2.taker,
            fill_events_2.order_kind,
            fill_events_2.order_source_id_int,
            fill_events_2.fill_source_id,
            fill_events_2.aggregator_source_id
          FROM fill_events_2
          WHERE (
            fill_events_2.timestamp,
            fill_events_2.tx_hash,
            fill_events_2.log_index,
            fill_events_2.batch_index
          ) < (
            $/timestamp/,
            $/txHash/,
            $/logIndex/,
            $/batchIndex/
          )
          ORDER BY
            fill_events_2.timestamp DESC,
            fill_events_2.tx_hash DESC,
            fill_events_2.log_index DESC,
            fill_events_2.batch_index DESC
          LIMIT $/limit/
        `,
        {
          limit,
          timestamp,
          txHash: toBuffer(txHash),
          logIndex,
          batchIndex,
        }
      );

      const values: any[] = [];
      const columns = new pgp.helpers.ColumnSet(
        ["tx_hash", "log_index", "batch_index", "fill_source_id", "aggregator_source_id", "taker"],
        {
          table: "fill_events_2",
        }
      );
      for (const {
        tx_hash,
        log_index,
        batch_index,
        address,
        order_kind,
        order_source_id_int,
        aggregator_source_id,
        taker,
        fill_source_id,
      } of results) {
        if (order_source_id_int && (!fill_source_id || !aggregator_source_id)) {
          const data = await extractAttributionData(
            fromBuffer(tx_hash),
            order_kind,
            fromBuffer(address)
          );
          if (data.fillSource || data.aggregatorSource || data.taker) {
            values.push({
              tx_hash,
              log_index,
              batch_index,
              fill_source_id: data.fillSource ? data.fillSource.id : fill_source_id,
              aggregator_source_id: data.aggregatorSource
                ? data.aggregatorSource.id
                : aggregator_source_id,
              taker: data.taker ? toBuffer(data.taker) : taker,
            });
          }
        }
      }

      if (values.length) {
        await idb.none(
          `
          UPDATE fill_events_2 SET
            fill_source_id = x.fill_source_id::INT,
            aggregator_source_id = x.aggregator_source_id::INT,
            taker = x.taker::BYTEA
          FROM (
            VALUES ${pgp.helpers.values(values, columns)}
          ) AS x(tx_hash, log_index, batch_index, fill_source_id, aggregator_source_id, taker)
          WHERE fill_events_2.tx_hash = x.tx_hash::BYTEA
            AND fill_events_2.log_index = x.log_index::INT
            AND fill_events_2.batch_index = x.batch_index::INT
          `
        );
      }

      if (results.length >= limit) {
        const lastResult = results[results.length - 1];
        await addToQueue(
          lastResult.timestamp,
          fromBuffer(lastResult.tx_hash),
          lastResult.log_index,
          lastResult.batch_index
        );
      }
    },
    { connection: redis.duplicate(), concurrency: 1 }
  );

  worker.on("error", (error) => {
    logger.error(QUEUE_NAME, `Worker errored: ${error}`);
  });

  redlock
    .acquire([`${QUEUE_NAME}-lock-6`], 60 * 60 * 24 * 30 * 1000)
    .then(async () => {
      await addToQueue(now(), HashZero, 0, 0);
    })
    .catch(() => {
      // Skip on any errors
    });
}

export const addToQueue = async (
  timestamp: number,
  txHash: string,
  logIndex: number,
  batchIndex: number
) => {
  await queue.add(randomUUID(), { timestamp, txHash, logIndex, batchIndex });
};
