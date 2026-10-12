/**
 * 转发文件：显示名派生的**唯一实现**已上移到 `@shared/mechanism-display-name`
 *（客户端与服务端 chat 共用，见该文件顶部说明）。
 *
 * ⚠️ 不要在本文件里新增或改写显示名逻辑——服务端取不到就会各自复刻一份并漏掉
 * 「（试译）后缀剥离」「HTML 实体解码」两步。新增显示名需求一律改 shared 那份。
 */
export {
  TENTATIVE_SUFFIX,
  displayNameOf,
  type MechanismDisplayName,
} from '@shared/mechanism-display-name';
