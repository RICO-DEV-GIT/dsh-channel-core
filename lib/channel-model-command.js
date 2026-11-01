import { currentSelection, decodeModel, defaultEffort, describeSelection, findModel, effortChoices } from '../channels/discord/model-commands.js';
import { describeModelCardDiagnostics } from './model-card-diagnostics.js';

/**
 * A fresh, never-aborted signal.
 *
 * The Host's session API takes (request, signal) and calls signal.throwIfAborted()
 * unconditionally; calling it with only the request throws
 * "Cannot read properties of undefined (reading 'aborted')" — exactly what /model
 * reported to the operator.
 */
const neverAborted = () => new AbortController().signal;

/** Models listed per message: ten numbered lines fit a phone without truncation. */
export const TEXT_PAGE_SIZE = 10;

/** Same native Host model interface as Discord; returned text is safe to show
 * after ChannelRuntime's sender/owner checks and ChannelCore's binding checks. */
export async function channelModelCommand(controller, sessionId, command, input, signal = neverAborted()) {
  if(!controller?.modelCatalog||!controller?.projections||!controller?.selectModel)
    return '当前 DSH Host 不支持模型命令。';
  const catalog=await controller.modelCatalog();
  const selected=currentSelection(catalog,await controller.projections({sessionId},signal));
  const args=String(input??'').trim();
  const candidates=groups=>groups.flatMap(group=>(group.models??[]).map(entry=>({provider:group.id,model:entry.id,name:entry.name??entry.id})));
  const listed=candidates(catalog?.groups??[]);
  const pageCount=()=>Math.max(1,Math.ceil(listed.length/TEXT_PAGE_SIZE));

  /**
   * One numbered page of the catalog. Every entry is a single short line that wraps on a
   * phone instead of being truncated, and `/model <n>` turns the page — text paging works
   * even where a card button does not.
   */
  const page=(index)=>{
    const pages=pageCount();
    const safe=Math.min(Math.max(1,index),pages);
    const slice=listed.slice((safe-1)*TEXT_PAGE_SIZE,safe*TEXT_PAGE_SIZE);
    const lines=slice.map((item,offset)=>(safe-1)*TEXT_PAGE_SIZE+offset+1+'. '+item.provider+'/'+item.model);
    const nav=[];
    if(safe<pages)nav.push('/model '+(safe+1));
    if(safe>1)nav.push('/model '+(safe-1));
    return [
      '当前模型：'+describeSelection(catalog,selected),
      '',
      '第 '+safe+'/'+pages+' 页 · 共 '+listed.length+' 个可对话模型',
      lines.join('\n'),
      '',
      '切换：/model 提供方/模型ID',
      nav.length?'翻页：'+nav.join(' · '):'',
    ].filter(line=>line!=='').join('\n');
  };

  if(command==='model'){
    // `/model probe` prints what the last card taps actually delivered, so a card that
    // does nothing can be diagnosed from chat instead of guessed at.
    if(args==='probe')return describeModelCardDiagnostics();
    if(!args){
      if(!listed.length)return '当前模型：'+describeSelection(catalog,selected)+'\n\n（没有可用的对话模型）';
      return page(1);
    }
    // A bare number turns the page: paging that no card UI can block.
    if(/^\d+$/.test(args)){
      const index=Number.parseInt(args,10);
      if(!listed.length)return '没有可用的对话模型。';
      if(index<1||index>pageCount())
        return '页码超出范围：共 '+pageCount()+' 页。\n\n使用 /model 1 查看第一页。';
      return page(index);
    }
    let chosen=decodeModel(args);
    if(!chosen){
      // Only an exact provider ID resolves; never auto-select from multiple models.
      const matches=(catalog?.groups??[]).filter(group=>group.id===args);
      if(matches.length!==1)return '未找到这个提供方。使用 /model 查看可选的提供方和模型。';
      const models=candidates(matches);
      if(!models.length)return '提供方 '+args+' 当前没有可用模型。';
      if(models.length>1)return '提供方 '+args+' 有 '+models.length+' 个可选模型，请指定完整名称：\n\n'+(models.slice(0,20).map(item=>'• '+item.provider+'/'+item.model).join('\n'))+'\n\n使用方法：/model provider/model';
      chosen={provider:models[0].provider,model:models[0].model};
    }
    if(!findModel(catalog,chosen.provider,chosen.model))
      return '未找到这个模型。使用 /model 查看可选的 provider/model。';
    const effort=defaultEffort(catalog,chosen.provider,chosen.model);
    const result=await controller.selectModel({sessionId,...chosen,...(effort===undefined?{}:{reasoningEffort:effort})},signal);
    return '已切换模型：'+describeSelection(catalog,result?.selected??{...chosen,reasoningEffort:effort})+'\n从下一次请求开始生效。';
  }
  if(command==='think'){
    if(!selected?.provider||!selected?.model)return '当前会话尚未选择模型，请先用 /model。';
    const choices=effortChoices(catalog,selected.provider,selected.model);
    if(!choices.length)return '当前模型 '+selected.model+' 没有公布可选的推理强度。';
    const list=choices.map(c=>'• '+c.value+' · '+c.name).join('\n');
    if(!args)return '当前推理强度：'+describeSelection(catalog,selected)+'\n\n使用 /think 强度ID 切换。\n\n可选强度：\n'+list;
    const found=choices.find(c=>c.value===args);
    if(!found)return '推理强度不可用。\n\n使用 /think 强度ID 切换。\n\n可选强度：\n'+list;
    const result=await controller.selectModel({sessionId,provider:selected.provider,model:selected.model,reasoningEffort:found.value},signal);
    return '推理强度已更新：'+describeSelection(catalog,result?.selected??{...selected,reasoningEffort:found.value})+'\n从下一次请求开始生效。';
  }
  throw new Error('unsupported-model-command');
}
