-- Local role passwords are supplied by the migrator as psql variables.
-- They are not production secrets and are not embedded in this file.
ALTER ROLE monytix_api WITH LOGIN PASSWORD :'api_password';
ALTER ROLE monytix_intelligence WITH LOGIN PASSWORD :'intelligence_password';
ALTER ROLE monytix_api NOINHERIT NOBYPASSRLS;
ALTER ROLE monytix_intelligence NOINHERIT NOBYPASSRLS;
