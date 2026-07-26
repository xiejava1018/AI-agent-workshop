<!--
  views/skill-curated/modules/CuratedEditor.vue

  技能精选 entry 编辑/新建表单。
  - entry === null → 新建模式
  - entry !== null → 编辑模式 (slug 不可改)
-->
<template>
  <div class="curated-editor">
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="right"
      :disabled="readonly"
    >
      <el-form-item label="Slug" prop="slug">
        <el-input
          v-model="form.slug"
          :disabled="isEdit"
          placeholder="小写字母/数字/连字符, 如 draw-diagram"
        />
        <div class="form-hint" v-if="isEdit">slug 创建后不可修改</div>
      </el-form-item>

      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" placeholder="技能显示名称" />
      </el-form-item>

      <el-form-item label="分类" prop="category">
        <el-select v-model="form.category" allow-create filterable default-first-option>
          <el-option
            v-for="c in categoryOptions"
            :key="c.value"
            :label="c.label"
            :value="c.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="标签">
        <el-select
          v-model="form.tags"
          multiple
          filterable
          allow-create
          default-first-option
          placeholder="输入后回车添加"
        />
      </el-form-item>

      <el-form-item label="摘要">
        <el-input v-model="form.summary" type="textarea" :rows="2" placeholder="一句话描述" />
      </el-form-item>

      <el-form-item label="描述">
        <el-input v-model="form.description" type="textarea" :rows="4" placeholder="详细描述" />
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="版本">
            <el-input v-model="form.version" placeholder="1.0.0" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="作者">
            <el-input v-model="form.author" placeholder="作者/团队" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="来源类型">
            <el-select v-model="form.sourceKind">
              <el-option label="内置" value="builtin" />
              <el-option label="本地" value="local" />
              <el-option label="远程" value="remote" />
              <el-option label="包" value="package" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="可见性">
            <el-select v-model="form.visibility">
              <el-option label="全局" value="global" />
              <el-option label="团队" value="team" />
              <el-option label="个人" value="user" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="源文件路径">
        <el-input v-model="form.sourceFilePath" placeholder="绝对路径, 用于 join GET /api/skills" />
      </el-form-item>

      <el-form-item label="源 URL">
        <el-input v-model="form.sourceUrl" placeholder="https://..." />
      </el-form-item>

      <el-form-item label="图标">
        <el-input v-model="form.icon" placeholder="star/cpu/code/tool" style="width: 200px" />
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="精选">
            <el-switch v-model="form.featured" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="启用">
            <el-switch v-model="form.enabled" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="安装次数">
            <el-input-number v-model="form.installCount" :min="0" controls-position="right" />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <div class="editor-actions" v-if="!readonly">
      <el-button @click="$emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, computed, watchEffect } from 'vue'
  import type { FormInstance, FormRules } from 'element-plus'
  import { ElMessage } from 'element-plus'
  import {
    createCuratedSkill,
    updateCuratedSkill,
    type CuratedSkillMeta,
    type CuratedSkillInput,
    type CuratedSourceKind,
    type CuratedVisibility
  } from '@/api/curated-skills'

  const props = defineProps<{ entry: CuratedSkillMeta | null; readonly?: boolean }>()
  const emit = defineEmits<{
    (e: 'saved'): void
    (e: 'cancel'): void
  }>()

  const isEdit = computed(() => !!props.entry)
  const formRef = ref<FormInstance>()
  const saving = ref(false)

  const form = reactive({
    slug: '',
    name: '',
    category: 'general',
    tags: [] as string[],
    summary: '',
    description: '',
    version: '1.0.0',
    author: '',
    sourceKind: 'builtin' as CuratedSourceKind,
    sourceFilePath: '',
    sourceUrl: '',
    icon: '',
    visibility: 'global' as CuratedVisibility,
    featured: false,
    enabled: true,
    installCount: 0
  })

  watchEffect(() => {
    if (props.entry) {
      Object.assign(form, props.entry)
    }
  })

  const rules: FormRules = {
    slug: [
      { required: true, message: '请输入 slug', trigger: 'blur' },
      { pattern: /^[a-z0-9][a-z0-9-]*$/, message: '仅小写字母/数字/连字符', trigger: 'blur' }
    ],
    name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
    category: [{ required: true, message: '请选择分类', trigger: 'change' }]
  }

  const categoryOptions = [
    { value: 'general', label: '通用' },
    { value: 'development', label: '开发' },
    { value: 'security', label: '安全' },
    { value: 'ops', label: '运维' },
    { value: 'data', label: '数据' },
    { value: 'writing', label: '写作' }
  ]

  async function onSave() {
    if (!formRef.value) return
    await formRef.value.validate()
    saving.value = true
    try {
      const payload: CuratedSkillInput = {
        slug: form.slug,
        name: form.name,
        category: form.category,
        tags: form.tags,
        summary: form.summary,
        description: form.description,
        version: form.version,
        author: form.author,
        sourceKind: form.sourceKind,
        sourceFilePath: form.sourceFilePath,
        sourceUrl: form.sourceUrl,
        icon: form.icon,
        visibility: form.visibility,
        featured: form.featured,
        enabled: form.enabled,
        installCount: form.installCount
      }
      if (isEdit.value && props.entry) {
        await updateCuratedSkill(props.entry.id, payload)
        ElMessage.success('已更新')
      } else {
        await createCuratedSkill(payload)
        ElMessage.success('已创建')
      }
      emit('saved')
    } catch (e) {
      ElMessage.error('保存失败: ' + (e as Error).message)
    } finally {
      saving.value = false
    }
  }
</script>

<style scoped>
  .curated-editor {
    padding: 0 20px;
  }
  .form-hint {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-top: 4px;
  }
  .editor-actions {
    margin-top: 24px;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
</style>
