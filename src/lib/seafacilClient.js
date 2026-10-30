import pg from 'pg';

const { Pool } = pg;

let poolInstance = null;

export const CXC_SCHEMA = 'blisscorp_bi';
export const CXC_VIEWS = {
  doc: `${CXC_SCHEMA}.v_cxc_doc`,
  mensual: `${CXC_SCHEMA}.v_cxc_mensual`,
  semanal: `${CXC_SCHEMA}.v_cxc_semanal`
};

function getPool() {
  if (!poolInstance) {
    const { SEAFACIL_PG_HOST, SEAFACIL_PG_PORT, SEAFACIL_PG_DATABASE, SEAFACIL_PG_USER, SEAFACIL_PG_PASSWORD } = process.env;
    if (!SEAFACIL_PG_HOST || !SEAFACIL_PG_DATABASE || !SEAFACIL_PG_USER || !SEAFACIL_PG_PASSWORD) {
      throw new Error('Faltan las variables SEAFACIL_PG_* (HOST, DATABASE, USER, PASSWORD) en .env / Vercel.');
    }
    poolInstance = new Pool({
      host: SEAFACIL_PG_HOST,
      port: Number(SEAFACIL_PG_PORT) || 5432,
      database: SEAFACIL_PG_DATABASE,
      user: SEAFACIL_PG_USER,
      password: SEAFACIL_PG_PASSWORD,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      ssl: true
    });
  }
  return poolInstance;
}

export async function queryReadOnly(text, params = []) {
  const result = await getPool().query(text, params);
  return result.rows;
}

export async function describeView(view) {
  const [schema, name] = view.split('.');
  return queryReadOnly(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, name]
  );
}
