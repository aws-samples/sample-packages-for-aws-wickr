# Backup and Restore MySQL

This is the instructions to backup and restore Wickr Enterprise internal database.

Overall steps

1. Put server offline
    1. When Enterprise 6.58.x is deployed, in KOTS admin console
    2. Check box “Database Upgrade Confirmation”
    3. Save the config change then deploy
2. Backup DB
3. Migrate to MySQL 8, by deploying Ent 6.62.x
    1. Check for update if preflight check failed
    2. Ingress/server will be back online along with the upgrade
4. Rollback and restore (only if needed)

It is crucial to put server offline to prevent database being updated during the migration to ensure data integrity in the event of a rollback being required. The server can be brought back once the migration or rollback is complete.

In Embedded Clusters the namespace is `kotsadm`, so replace `-n wickr` with `-n kotsadm` in following commands.

## Backup

When kubectl has access to the cluster

* Export DB Dump File

    ```bash
    kubectl exec mysql-primary-0 -c mysql -n wickr \
    -- mysqldump \
        -uroot \
        -p$MYSQL_ROOT_PASSWORD \
        --single-transaction \
        --routines wickrdb \
        > ./wickrdb_$(date +%Y.%-m.%-d-%H:%M).sql
    ```

## Restore

* Restore MySQL to Clean State (only if rollback from database upgrade)
  * Delete mysql statefulset

    `kubectl delete statefulset -n wickr mysql-primary mysql-secondary`
  * Delete mysql PVC

    `kubectl delete pvc -n wickr data-mysql-primary-0 data-mysql-secondary-0`
    * Rollback Wickr Enterprise to 6.58.1 in KOTS admin console or CLI
      * In KOTS admin console → Version history
      * There will be two versions of 6.58.1 in version history
        * Config change that enables “Database Upgrade Confirmation” (server will be offline)
        * First installation/upgrade to 6.58.1 (server will be online)
      * Rollback to the version: Config change that enables “Database Upgrade Confirmation”

* Import Dump File Back

    ```bash
    kubectl exec mysql-primary-0 -c mysql -n wickr \
    -- mysql \
        -uroot \
        -p$MYSQL_ROOT_PASSWORD wickrdb \
        < ./wickrdb_date.sql
    ```

  * Rollback to the version: First installation/upgrade to 6.58.1 (server will be online)
