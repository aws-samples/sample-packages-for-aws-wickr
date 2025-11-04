# Backup and Restore MySQL

This is the instructions to backup and restore Wickr Enterprise internal database.

Overall steps

1. Follow these steps to put server **offline**
    1. In the KOTS admin console config, check box “Database Upgrade Confirmation” (only on 6.58.x)
    2. Save the config change then deploy
2. Backup DB
3. Migrate to MySQL 8, by deploying Ent 6.62.x
    1. If preflight check failed at database backup
        1. In the KOTS admin console, edit (wrench icon) the config of version (6.62.x) you try to deploy
        2. Check box “Database Backed Up”
        3. Save the config change then deploy
    2. Ingress/server will be back online along with the upgrade
4. Rollback and restore (only if needed)

It is crucial to put server offline to prevent database being updated during the migration to ensure data integrity in the event of a rollback being required. The server can be brought back once the migration or rollback is complete.

In Embedded Clusters the namespace is `kotsadm`, so replace `-n wickr` with `-n kotsadm` in following commands.

## Backup

Do not Backup without putting server offline. When kubectl has access to the cluster

* Export DB Dump File

    ```bash
    kubectl exec mysql-primary-0 -c mysql -n wickr \
      -- bash -c 'mysqldump \
                    -uroot \
                    -p$MYSQL_ROOT_PASSWORD \
                    --single-transaction \
                    --routines wickrdb' \
      > ./wickrdb_$(date +%Y.%-m.%-d-%H:%M).sql
    ```

## Restore

* Restore MySQL to Clean State (only if rollback from database upgrade)
  * Delete mysql statefulsets

    `kubectl delete statefulset -n wickr mysql-primary mysql-secondary`
  * Delete mysql PVCs

    `kubectl delete pvc -n wickr data-mysql-primary-0 data-mysql-secondary-0`
  * Rollback Wickr Enterprise to 6.58.x in KOTS admin console or CLI
    * In KOTS admin console → Version history
    * Rollback to 6.58.x that enables “Database Upgrade Confirmation”
      * To check the config of previously deployed version, click "Edit config" (wrench icon)

* Import Dump File Back

    ```bash
    kubectl exec -i mysql-primary-0 -c mysql -n wickr \
      -- bash -c 'mysql -uroot -p$MYSQL_ROOT_PASSWORD wickrdb' \
      < ./wickrdb_date.sql
    ```

  * Follow these steps to bring server **online**
    * In the KOTS admin console config, uncheck box “Database Upgrade Confirmation” (only on 6.58.x)
    * Save the config change then deploy

---

## Reset rabbitmq

If rabbitmq is not healthy after rollback, try

* Delete rabbitmq statefulset

    `kubectl delete statefulset -n wickr rabbitmq`
* Delete rabbitmq PVCs (all "data-rabbitmq-*")

    `kubectl delete pvc -n wickr data-rabbitmq-0 data-rabbitmq-1 data-rabbitmq-2`
* Redeploy (currently deployed version) in KOTS admin console
